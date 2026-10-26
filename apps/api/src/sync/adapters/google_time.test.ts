import assert from "node:assert/strict";
import { expandRecurringEvents } from "@musubi/calendar";
import { fetchGoogleChanges } from "./google";
import { googleEventState } from "./provider_event_state";

const native = {
  id: "all-day-series",
  summary: "Synthetic series",
  status: "confirmed",
  start: { date: "2026-03-02" },
  end: { date: "2026-03-03" },
  recurrence: ["RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20260316T070000Z;INTERVAL=1;BYDAY=MO"],
  organizer: { self: true, email: "owner@example.test" },
  reminders: { useDefault: true },
};

async function imported(item: Record<string, unknown> = native, timeZone: string | null = "UTC") {
  const result = await fetchGoogleChanges("synthetic-token", "synthetic-calendar", null, {
    timeModels: true,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, undefined, "import only reads the provider");
      return Response.json({ items: [item], ...(timeZone === null ? {} : { timeZone }), nextSyncToken: "cursor" });
    },
  });
  assert.equal(result.changes.length, 1);
  const change = result.changes[0]!;
  assert.equal(change.kind, "event");
  if (change.kind !== "event") throw new Error("Expected event");
  return change.data;
}

function starts(event: Awaited<ReturnType<typeof imported>>) {
  return expandRecurringEvents(
    [{ ...event, id: "00000000-0000-4000-8000-000000000001" }],
    new Date("2026-03-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"),
    { consumerTimeZone: "America/Los_Angeles" },
  ).map(value => value.start.toISOString().slice(0, 10));
}

async function pageTimeZones() {
  const pages = [
    Response.json({ timeZone: "America/Los_Angeles", items: [native], nextPageToken: "two" }),
    new Response(null, { status: 410 }),
    Response.json({ timeZone: "UTC", items: [native], nextSyncToken: "replacement" }),
  ];
  const result = await fetchGoogleChanges("token", "calendar", "expired", {
    timeModels: true, fetchImpl: async () => pages.shift()!,
  });
  assert.equal(pages.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.nextCursor, "replacement");
  const event = result.changes[0]!;
  assert.equal(event.kind === "event" && event.data.recurrence, "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20260316;INTERVAL=1;BYDAY=MO");
  const inconsistent = [
    Response.json({ timeZone: "UTC", items: [native], nextPageToken: "two" }),
    Response.json({ timeZone: "America/Los_Angeles", items: [], nextSyncToken: "bad" }),
  ];
  await assert.rejects(fetchGoogleChanges("token", "calendar", null, {
    timeModels: true, fetchImpl: async () => inconsistent.shift()!,
  }), /time zone changed/);
}

async function main() {
  const original = structuredClone(native);
  const event = await imported();
  assert.equal(event.recurrence, "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20260316;INTERVAL=1;BYDAY=MO");
  assert.deepEqual(starts(event), ["2026-03-02", "2026-03-09", "2026-03-16"]);
  assert.deepEqual(native, original, "normalization leaves the native event unchanged");
  assert.deepEqual(event.providerState, googleEventState(native));

  for (const until of ["20260316T000000Z", "20260316T235959Z", "20260316"]) {
    const item = { ...native, recurrence: [`RRULE:FREQ=WEEKLY;UNTIL=${until}`] };
    assert.deepEqual(starts(await imported(item)), ["2026-03-02", "2026-03-09", "2026-03-16"]);
  }
  const extraDates = { ...native, recurrence: [...native.recurrence, "EXDATE;VALUE=DATE:20260309", "RDATE;VALUE=DATE:20260317"] };
  assert.deepEqual(starts(await imported(extraDates)), ["2026-03-02", "2026-03-16", "2026-03-17"]);
  for (const zone of [null, "America/Los_Angeles", "Europe/Prague"]) {
    const unchanged = await imported(native, zone);
    assert.equal(unchanged.recurrence, native.recurrence.join("\n"));
    assert.throws(() => starts(unchanged), /recurrence-value-kind-mismatch/);
  }
  for (const until of ["20260316T240000Z", "20260316T070000", "20260230T070000Z"]) {
    const invalid = await imported({ ...native, recurrence: [`RRULE:FREQ=WEEKLY;UNTIL=${until}`] });
    assert.throws(() => starts(invalid));
  }
  const timed = await imported({ ...native,
    start: { dateTime: "2026-03-02T08:00:00Z", timeZone: "UTC" },
    end: { dateTime: "2026-03-02T09:00:00Z", timeZone: "UTC" },
  });
  assert.equal(timed.recurrence, native.recurrence.join("\n"));
  assert.deepEqual(starts(timed), ["2026-03-02", "2026-03-09"], "timed cutoff still excludes the later start");
  await pageTimeZones();
  console.log("google time import tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
