import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureCalendars } from "../fixtures";
import { QuickCreate } from "./QuickCreate";

afterEach(cleanup);

it.each(["00", "01"])("keeps Prague's %s:30Z fold and the mounted draft when expanding in place", async (hour) => {
  const user = userEvent.setup();
  const exactRange = { start: new Date(`2026-10-25T${hour}:30:00Z`), end: new Date(`2026-10-25T${hour}:45:00Z`) };
  const onCreate = vi.fn(async (event) => event);
  const onOpenChange = vi.fn();
  render(<QuickCreate
    anchor={{ x: 10, y: 10 }} calendars={fixtureCalendars} date="2026-10-25" email="alex@example.com"
    startTime="02:30" endTime="02:45" exactRange={exactRange} onCreate={onCreate} onCreated={vi.fn()}
    onOpenChange={onOpenChange} open timeFormat="24h" userId="alex" weekStartsOn="monday"
  />);
  const title = screen.getByRole("textbox", { name: "Event title" });
  await user.type(title, "Fold meeting");
  await user.type(screen.getByPlaceholderText("Add location"), "Studio B");
  const form = title.closest("form");
  const originalUrl = window.location.href;
  await user.click(screen.getByRole("button", { name: "Expand event editor" }));
  expect(form?.dataset.layout).toBe("page");
  await user.click(screen.getByRole("button", { name: "Collapse event editor" }));
  expect(form?.dataset.layout).toBe("panel");
  await user.click(screen.getByRole("button", { name: "Expand event editor" }));
  expect(screen.getByRole("textbox", { name: "Event title" })).toBe(title);
  expect((screen.getByPlaceholderText("Add location") as HTMLInputElement).value).toBe("Studio B");
  expect(window.location.href).toBe(originalUrl);
  expect(onOpenChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ ...exactRange, title: "Fold meeting", location: "Studio B" });
});

it("moves a titled draft between identical civil fold fields using the exact range", async () => {
  const user = userEvent.setup();
  const first = { start: new Date("2026-10-25T00:30:00Z"), end: new Date("2026-10-25T00:45:00Z") };
  const second = { start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:45:00Z") };
  const onCreate = vi.fn(async (event) => event);
  const props = { anchor: { x: 10, y: 10 }, calendars: fixtureCalendars, date: "2026-10-25", email: "alex@example.com", startTime: "02:30", endTime: "02:45", onCreate, onCreated: vi.fn(), onOpenChange: vi.fn(), open: true, timeFormat: "24h" as const, userId: "alex", weekStartsOn: "monday" as const };
  const view = render(<QuickCreate {...props} exactRange={first} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Moved fold");
  view.rerender(<QuickCreate {...props} exactRange={second} />);
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ ...second, title: "Moved fold" });
});

it("refuses a typed spring gap without sending a create write", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async (event) => event);
  render(<QuickCreate anchor={{ x: 10, y: 10 }} calendars={fixtureCalendars} date="2026-03-29" email="alex@example.com" startTime="01:30" endTime="03:30"
    exactRange={{ start: new Date("2026-03-29T00:30:00Z"), end: new Date("2026-03-29T01:30:00Z") }}
    onCreate={onCreate} onCreated={vi.fn()} onOpenChange={vi.fn()} open timeFormat="24h" userId="alex" weekStartsOn="monday" />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Gap meeting");
  const start = screen.getByRole("combobox", { name: "Start time" });
  await user.clear(start);
  await user.type(start, "02:30");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("missing or occurs twice");
});

it("keeps the untouched second-fold start when the end is edited", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async (event) => event);
  render(<QuickCreate anchor={{ x: 10, y: 10 }} calendars={fixtureCalendars} date="2026-10-25" email="alex@example.com" startTime="02:30" endTime="02:45"
    exactRange={{ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:45:00Z") }}
    onCreate={onCreate} onCreated={vi.fn()} onOpenChange={vi.fn()} open timeFormat="24h" userId="alex" weekStartsOn="monday" />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Longer fold meeting");
  const end = screen.getByRole("combobox", { name: "End time" });
  await user.clear(end);
  await user.type(end, "03:30");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T02:30:00Z") });
});

const panelProps = {
  anchor: { x: 10, y: 10 }, calendars: fixtureCalendars, date: "2026-09-11", email: "alex@example.com",
  onCreated: vi.fn(), open: true, timeFormat: "24h" as const, userId: "alex", weekStartsOn: "monday" as const,
};

it("creates in the preferred shared calendar as both home and sole membership", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  render(<QuickCreate {...panelProps} defaultEventCalendarId="studio" onCreate={onCreate} onOpenChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Choose calendars. Studio is home. Event appears in 1 calendar." })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Shared plan");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({
    title: "Shared plan", originCalendarID: "studio", calendars: ["studio"], color: fixtureCalendars[1]!.color,
  });
});

it("overrides the shared default with only the private home calendar for this event", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  render(<QuickCreate {...panelProps} defaultEventCalendarId="studio" onCreate={onCreate} onOpenChange={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Private appointment");
  await user.click(screen.getByRole("button", { name: /^Choose calendars/ }));
  await user.click(screen.getByRole("radio", { name: "Personal as home calendar" }));
  expect((screen.getByRole("checkbox", { name: "Show event in Studio" }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({
    title: "Private appointment", originCalendarID: "personal", calendars: ["personal"], color: fixtureCalendars[0]!.color,
  });
});

it.each([
  { label: "missing", preferredId: "deleted" },
  { label: "read-only", preferredId: "read-only" },
  { label: "task-only", preferredId: "tasks" },
  { label: "unset", preferredId: undefined },
  { label: "automatic", preferredId: null },
])("falls back to Personal for a $label preference", async ({ preferredId }) => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  const calendars = [
    { ...fixtureCalendars[1]!, id: "read-only", role: "viewer" },
    { ...fixtureCalendars[1]!, id: "tasks", supportsEvents: false, supportsTasks: true },
    fixtureCalendars[1]!, fixtureCalendars[0]!,
  ];
  render(<QuickCreate {...panelProps} calendars={calendars} defaultEventCalendarId={preferredId} onCreate={onCreate} onOpenChange={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Fallback plan");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ originCalendarID: "personal", calendars: ["personal"] });
});

it.each([
  { label: "read-only", role: "viewer", supportsEvents: true },
  { label: "task-only", role: "owner", supportsEvents: false },
])("uses the first writable event calendar when Personal is $label", async ({ role, supportsEvents }) => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  const calendars = [{ ...fixtureCalendars[0]!, role, supportsEvents }, fixtureCalendars[1]!];
  render(<QuickCreate {...panelProps} calendars={calendars} defaultEventCalendarId="personal" onCreate={onCreate} onOpenChange={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Writable fallback");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ originCalendarID: "studio", calendars: ["studio"] });
});

it.each(["studio", "personal"])("keeps a mounted %s draft when the preference changes", async (homeId) => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  const props = { ...panelProps, onCreate, onOpenChange: vi.fn() };
  const view = render(<QuickCreate {...props} defaultEventCalendarId="studio" />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Draft in progress");
  await user.type(screen.getByPlaceholderText("Add location"), "Studio B");
  if (homeId === "personal") {
    await user.click(screen.getByRole("button", { name: /^Choose calendars/ }));
    await user.click(screen.getByRole("radio", { name: "Personal as home calendar" }));
  }
  view.rerender(<QuickCreate {...props} defaultEventCalendarId="family-calendar" />);
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({
    title: "Draft in progress", location: "Studio B", originCalendarID: homeId, calendars: [homeId],
  });
});

it("keeps a new event draft through Escape until discard is confirmed", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(<QuickCreate {...panelProps} onCreate={async event => event} onOpenChange={onOpenChange} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Unfinished event");
  await user.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Discard new event?" })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Keep editing" }).at(-1)!);
  expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Unfinished event");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard event" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("closes a reverted empty draft without a discard prompt", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(<QuickCreate {...panelProps} onCreate={async event => event} onOpenChange={onOpenChange} />);
  const title = screen.getByRole("textbox", { name: "Event title" });
  await user.type(title, "Changed my mind");
  await user.clear(title);
  await user.click(screen.getByRole("button", { name: "Close new event" }));
  expect(screen.queryByRole("dialog", { name: "Discard new event?" })).toBeNull();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("protects changes made by dragging the grid draft", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const view = render(<QuickCreate {...panelProps} onCreate={async event => event} onOpenChange={onOpenChange} />);
  view.rerender(<QuickCreate {...panelProps} date="2026-09-12" onCreate={async event => event} onOpenChange={onOpenChange} />);
  await user.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Discard new event?" })).toBeTruthy();
});

it("keeps the panel open while saving and retains the draft after a failed write", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const onSavingChange = vi.fn();
  let fail!: (error: Error) => void;
  const onCreate = vi.fn(() => new Promise<never>((_, reject) => { fail = reject; }));
  render(<QuickCreate {...panelProps} onCreate={onCreate} onOpenChange={onOpenChange} onSavingChange={onSavingChange} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Retryable draft");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close new event" }));
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onSavingChange).toHaveBeenLastCalledWith(true);
  fail(new Error("Write failed"));
  await screen.findByRole("alert");
  expect(onSavingChange).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Retryable draft");
});


it("shows next-day Ends for a one-day event but writes only the selected day", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async event => event);
  render(<QuickCreate {...panelProps} onCreate={onCreate} onOpenChange={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "One-day plan");
  await user.click(screen.getByRole("switch", { name: "All day" }));
  expect(screen.getByRole("button", { name: /^Ends:/ }).textContent).toContain("Saturday, September 12, 2026");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
    isAllDay: true,
    start: new Date("2026-09-11T00:00:00.000Z"),
    end: new Date("2026-09-11T00:00:00.000Z"),
  });
});
