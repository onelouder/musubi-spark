import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import express, { type Request } from "express";
import pg from "pg";
import { SettingsDocumentSchema, SettingsSchema } from "@musubi/types";

type Database = typeof import("@musubi/db");
type Send = (method: string, path: string, body?: unknown) => Promise<Response>;
const settingsPath = "/api/v1/users/settings";
const patchPath = "/api/v1/users/me/settings";

async function startApp(userID: string) {
  const handlers = await import("./settings");
  const { middlewareErrorHandler } = await import("../middleware/error_handler");
  const app = express();
  app.use(express.json());
  // Authentication is the fixture port; handlers, serialization and DB are real.
  app.use((req, _res, next) => {
    req.user = { id: userID } as Request["user"];
    next();
  });
  app.get(settingsPath, handlers.handlerGetSettings);
  app.put(settingsPath, handlers.handlerSaveSettings);
  app.get(`${settingsPath}/document`, handlers.handlerGetSettingsDocument);
  app.patch(patchPath, handlers.handlerPatchSettings);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function roundtrip(send: Send, database: Database, userID: string, expected: string | null) {
  const raw = await send("GET", settingsPath);
  assert.equal(raw.status, 200);
  assert.equal(SettingsSchema.parse(await raw.json()).defaultEventCalendarId, expected);
  const response = await send("GET", `${settingsPath}/document`);
  assert.equal(response.status, 200);
  const document = SettingsDocumentSchema.parse(await response.json());
  assert.equal(document.value.defaultEventCalendarId, expected);
  const row = await database.getUserSettings(userID);
  assert.equal(row.defaultEventCalendarId, expected);
  assert.equal(row.revision, document.revision);
  return document;
}

async function checkPatches(send: Send, database: Database, userID: string, calendarID: string) {
  let current = await roundtrip(send, database, userID, null);
  for (const patch of [{ defaultEventCalendarId: calendarID }, { theme: "dark" }]) {
    const response = await send("PATCH", patchPath, { baseRevision: current.revision, patch });
    assert.equal(response.status, 200);
    const saved = SettingsDocumentSchema.parse(await response.json());
    assert.equal(saved.value.defaultEventCalendarId, calendarID);
    assert.equal(saved.revision, current.revision + 1);
    current = await roundtrip(send, database, userID, calendarID);
  }
  const conflict = await send("PATCH", patchPath, {
    baseRevision: current.revision - 1, patch: { defaultEventCalendarId: null },
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(SettingsDocumentSchema.parse((await conflict.json()).current), current);
  assert.deepEqual(await roundtrip(send, database, userID, calendarID), current);
  const cleared = await send("PATCH", patchPath, {
    baseRevision: current.revision, patch: { defaultEventCalendarId: null },
  });
  assert.equal(cleared.status, 200);
  assert.equal(SettingsDocumentSchema.parse(await cleared.json()).value.defaultEventCalendarId, null);
  assert.equal((await roundtrip(send, database, userID, null)).revision, current.revision + 1);
}

async function checkLegacySaves(send: Send, database: Database, userID: string) {
  const initial = await roundtrip(send, database, userID, null);
  const calendarID = randomUUID();
  const response = await send("PUT", settingsPath, {
    ...initial.value, defaultEventCalendarId: calendarID,
  });
  assert.equal(response.status, 200, "a stale calendar choice is still a preference");
  assert.equal(SettingsSchema.parse(await response.json()).defaultEventCalendarId, calendarID);
  const selected = await roundtrip(send, database, userID, calendarID);
  assert.equal(selected.revision, initial.revision + 1);
  const { defaultEventCalendarId: _omitted, ...legacy } = selected.value;
  const preserved = await send("PUT", settingsPath, { ...legacy, theme: "light" });
  assert.equal(preserved.status, 200);
  const current = await roundtrip(send, database, userID, calendarID);
  assert.equal(current.value.theme, "light");
  assert.equal(current.revision, selected.revision + 1);
  const cleared = await send("PUT", settingsPath, { ...legacy, defaultEventCalendarId: null });
  assert.equal(cleared.status, 200);
  assert.equal(SettingsSchema.parse(await cleared.json()).defaultEventCalendarId, null);
  assert.equal((await roundtrip(send, database, userID, null)).revision, current.revision + 1);
}

async function checkInvalidRequests(send: Send, database: Database, userID: string) {
  const current = await roundtrip(send, database, userID, null);
  for (const value of [false, 42, {}, []]) {
    const patch = await send("PATCH", patchPath, {
      baseRevision: current.revision, patch: { defaultEventCalendarId: value },
    });
    assert.equal(patch.status, 400);
    const put = await send("PUT", settingsPath, { ...current.value, defaultEventCalendarId: value });
    assert.equal(put.status, 400);
  }
  assert.deepEqual(await roundtrip(send, database, userID, null), current);
}

async function checkPermissions(send: Send, database: Database, userID: string, ownerID: string) {
  const calendar = await database.createCalendar({ creatorID: ownerID, name: "Private", color: "#112233" });
  assert.equal(await database.getUserRoleForCalendar(userID, calendar.id), null);
  const current = await roundtrip(send, database, userID, null);
  const response = await send("PATCH", patchPath, {
    baseRevision: current.revision, patch: { defaultEventCalendarId: calendar.id },
  });
  assert.equal(response.status, 200);
  await roundtrip(send, database, userID, calendar.id);
  assert.equal(await database.getUserRoleForCalendar(userID, calendar.id), null,
    "saving a preference never confers calendar membership");
  assert.equal((await database.getUserSettings(ownerID)).defaultEventCalendarId, null,
    "one user's preference never changes another user's settings");
}

async function exerciseSettings(database: Database) {
  const userID = randomUUID(), ownerID = randomUUID();
  await database.db.insert(database.user).values([userID, ownerID].map(id => ({
    id, name: "Settings test", email: `${id}@example.test`,
  })));
  const calendar = await database.createCalendar({ creatorID: ownerID, name: "Shared", color: "#112233" });
  await database.db.insert(database.calendarMembers).values({ userID, calendarID: calendar.id, role: "editor" });
  const server = await startApp(userID);
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send: Send = (method, path, body) => fetch(`${origin}${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    await checkPatches(send, database, userID, calendar.id);
    await checkLegacySaves(send, database, userID);
    await checkInvalidRequests(send, database, userID);
    await checkPermissions(send, database, userID, ownerID);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test", "Use only disposable PostgreSQL.");
  assert.ok(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Use local disposable PostgreSQL.");
  const name = `musubi_settings_${randomUUID().replace(/-/g, "")}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  let database: Database | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    // Import the production DB only after pointing config at the fresh database.
    process.env.DATABASE_URL = url.toString();
    database = await import("@musubi/db");
    await migrate(drizzle(database.db.$client), {
      migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    });
    await exerciseSettings(database);
    console.log("settings API/PostgreSQL roundtrip, omission, clearing, conflicts and permission isolation: OK");
  } finally {
    await database?.db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
