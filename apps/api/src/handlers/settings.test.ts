import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createPatchSettingsHandler } from "./settings";

const settings = {
  calendarOrder: [],
  createdAt: new Date("2026-07-26T10:00:00.000Z"),
  dateFormat: "dmy",
  defaultCalendarView: "month",
  defaultEventCalendarId: "shared-calendar",
  id: "user-1",
  defaultReminder: {
    minutesBefore: 10,
    allDay: { daysBefore: 1, atMinute: 1080 },
  },
  lastSeenAnnouncement: "",
  notificationEmails: { eventChanged: true, pollDecided: true },
  notificationsOnByDefault: true,
  onboarded: true,
  revision: 4,
  tabBarLabels: true,
  theme: "system",
  timeFormat: "24h",
  timezone: "Europe/Prague",
  updatedAt: new Date("2026-07-26T11:00:00.000Z"),
  weekStartsOn: "monday",
};

function responseRecorder() {
  let statusCode = 0;
  let payload: unknown;
  const response = {
    json(body: unknown) {
      payload = body;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;

  return {
    response,
    result: () => ({ payload, statusCode }),
  };
}

async function run() {
  {
    const { response, result } = responseRecorder();
    const handler = createPatchSettingsHandler({
      notify: () => undefined,
      patch: async () => ({ conflict: true, settings }),
    });
    await handler(
      {
        body: { baseRevision: 3, patch: { theme: "dark" } },
        requestId: "settings-conflict",
        user: { id: "user-1" },
      } as Request,
      response,
    );

    assert.equal(result().statusCode, 409);
    assert.deepEqual(result().payload, {
      current: {
        revision: 4,
        updatedAt: settings.updatedAt,
        value: {
          calendarOrder: [],
          dateFormat: "dmy",
          defaultCalendarView: "month",
          defaultEventCalendarId: "shared-calendar",
          defaultReminder: settings.defaultReminder,
          lastSeenAnnouncement: settings.lastSeenAnnouncement,
          notificationEmails: settings.notificationEmails,
          notificationsOnByDefault: true,
          onboarded: true,
          tabBarLabels: true,
          theme: "system",
          timeFormat: "24h",
          timezone: "Europe/Prague",
          weekStartsOn: "monday",
        },
      },
      error: "SettingsConflict",
      message: "Settings changed on another device.",
      requestId: "settings-conflict",
    });
  }

  {
    const notifications: unknown[] = [];
    const { response, result } = responseRecorder();
    const handler = createPatchSettingsHandler({
      notify: (...args) => {
        notifications.push(args);
      },
      patch: async () => ({
        conflict: false,
        settings: { ...settings, revision: 5, theme: "dark" },
      }),
    });
    await handler(
      {
        body: { baseRevision: 4, patch: { theme: "dark" } },
        requestId: "settings-saved",
        user: { id: "user-1" },
      } as Request,
      response,
    );

    assert.equal(result().statusCode, 200);
    assert.equal((result().payload as { revision: number }).revision, 5);
    assert.deepEqual(notifications, [
      [["user-1"], "settings_updated", { revision: 5 }],
    ]);
  }

  for (const defaultEventCalendarId of ["another-calendar", null]) {
    const { response, result } = responseRecorder();
    const handler = createPatchSettingsHandler({
      notify: () => undefined,
      patch: async (userID, revision, patch) => {
        assert.equal(userID, "user-1");
        assert.equal(revision, 4);
        assert.deepEqual(patch, { defaultEventCalendarId });
        return { conflict: false, settings: { ...settings, defaultEventCalendarId, revision: 5 } };
      },
    });
    await handler({
      body: { baseRevision: 4, patch: { defaultEventCalendarId } },
      user: { id: "user-1" },
    } as Request, response);
    assert.equal(result().statusCode, 200);
    assert.equal(
      (result().payload as { value: { defaultEventCalendarId: string | null } }).value.defaultEventCalendarId,
      defaultEventCalendarId,
    );
  }

  await assert.rejects(
    () =>
      createPatchSettingsHandler()(
        {
          body: {
            baseRevision: 4,
            patch: { unknownSetting: true },
          },
          user: { id: "user-1" },
        } as Request,
        responseRecorder().response,
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Request is missing a valid settings patch.",
  );
}

void run();
