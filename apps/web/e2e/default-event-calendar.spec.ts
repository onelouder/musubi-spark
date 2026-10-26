import { expect, test, type Page } from "@playwright/test";
import { CalendarSchema, DEFAULT_CALENDAR_COLOR, PRODUCT_VERSION, SettingsSchema } from "@musubi/types";
import { setTestTheme } from "./theme";

const pageId = "11111111-1111-4111-8111-111111111111";
const calendars = [
  { id: "personal", name: "Personal", isDefault: true },
  { id: "shared", name: "Shared", provider: "google" },
  { id: "private", name: "Private", provider: "google" },
].map(calendar => CalendarSchema.parse({ creatorID: "behavior-user", color: DEFAULT_CALENDAR_COLOR, role: "owner", members: [], ...calendar }));
const settings = SettingsSchema.parse({ notificationsOnByDefault: true, defaultCalendarView: "month", defaultEventCalendarId: "shared", weekStartsOn: "monday", dateFormat: "dmy", timeFormat: "24h", onboarded: true, theme: "system" });
const events = { events: [], deletedIds: [], serverTime: "2026-10-24T10:00:00Z" };

async function fixture(page: Page) {
  const writes: { originCalendarID: string; calendars: string[] }[] = [];
  const violations: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/stream") return new Promise<void>(() => {});
    if (path === "/api/v1/events" && method === "POST") {
      const body = request.postDataJSON();
      writes.push(body);
      return json({ ...body, revision: 1 });
    }
    if (method !== "GET") {
      violations.push(`Unexpected mutation ${method} ${path}`);
      return json({ error: "Unexpected fixture mutation" }, 500);
    }
    switch (path) {
      case "/api/auth/get-session": return json({
        session: { id: "behavior-session", userId: "behavior-user", token: "synthetic", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
        user: { id: "behavior-user", name: "Behavior QA", email: "behavior@example.invalid", emailVerified: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", image: null },
      });
      case "/api/v1/server": return json({ version: PRODUCT_VERSION, minClientVersion: "0.2.0", email: true, socials: [], socialsWeb: [], syncProviders: [], pushPublicKey: null });
      case "/api/v1/calendars": return json(calendars);
      case "/api/v1/tasks": return json({ tasks: [] });
      case "/api/v1/events": return json(events);
      case "/api/v1/users/settings": return json(settings);
      case "/api/v1/users/settings/document": return json({ revision: 1, updatedAt: "2026-01-01T00:00:00Z", value: settings });
      case "/api/v1/pages": return json([{
        id: pageId, name: "My calendar", isDefault: true, position: 0, revision: 1,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
        config: { schemaVersion: 1, calendarVisibility: { hiddenCalendarIds: [], mode: "all" }, filters: [], view: { configVersion: 1, id: "month", showAdjacentDays: true } },
      }]);
      case "/api/v1/announcements": return json({ announcements: [], isAdmin: false });
      case "/api/v1/event-deliveries":
      case "/api/v1/task-deliveries": return json({ items: [], nextCursor: null });
      case "/api/v1/federation/connections":
      case "/api/v1/connections": return json([]);
      case "/api/v1/reminders": return json({ calendars: {}, events: {}, default: { allDay: { atMinute: 1080, daysBefore: 1 }, minutesBefore: 10 } });
      default:
        violations.push(`Unexpected read ${path}`);
        return json({ error: "Unexpected fixture read" }, 500);
    }
  });
  return { writes, violations };
}

for (const width of [1280, 390]) {
  test(`default event calendar and per-event override at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setTestTheme(page, width === 390 ? "dark" : "light");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const state = await fixture(page);
    await page.goto(`/app/p/${pageId}/month/event/new?date=2026-10-24`);
    await expect(page.getByRole("radio", { name: "Shared as home calendar", exact: true })).toBeChecked();
    await page.getByRole("textbox", { name: "Event title" }).fill("Private appointment");
    await page.getByRole("radio", { name: "Private as home calendar", exact: true }).check();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toMatchObject({ originCalendarID: "private", calendars: ["private"] });
    await page.goto(`/app/p/${pageId}/month/event/new?date=2026-10-24`);
    await expect(page.getByRole("radio", { name: "Shared as home calendar", exact: true })).toBeChecked();
    await page.getByRole("textbox", { name: "Event title" }).fill("Shared appointment");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1]).toMatchObject({ originCalendarID: "shared", calendars: ["shared"] });
    expect(state.violations).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
