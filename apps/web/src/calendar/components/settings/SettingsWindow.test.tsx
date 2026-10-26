import { SettingsSchema, type SettingsDocument } from "@musubi/types";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureCalendars } from "../../fixtures";
import { SettingsWindow, type SettingsSectionId, type SettingsWindowProps } from "./SettingsWindow";

vi.mock("~/auth/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { name: "Aki", email: "aki@example.com", image: null } }, refetch: vi.fn() }) },
}));

const DOCUMENT: SettingsDocument = {
  revision: 1,
  updatedAt: new Date("2026-09-12T08:00:00.000Z"),
  value: SettingsSchema.parse({ dateFormat: "dmy", defaultCalendarView: "week", notificationsOnByDefault: true, timeFormat: "24h", weekStartsOn: "monday" }),
};

afterEach(cleanup);

function Harness({ initial, ...props }: Partial<SettingsWindowProps> & { initial: SettingsSectionId }) {
  const [section, setSection] = useState(initial);
  return (
    <SettingsWindow
      calendars={fixtureCalendars}
      onAdoptSettings={vi.fn()}
      onCreateCalendar={vi.fn()}
      onDisconnectCalendar={vi.fn()}
      onExportCalendar={vi.fn()}
      onImportCalendar={vi.fn()}
      onLoadSettings={async () => DOCUMENT}
      onManageMembers={vi.fn()}
      onNotice={vi.fn()}
      onOpenChange={vi.fn()}
      onPatchSettings={async () => DOCUMENT}
      onRemoveCalendar={vi.fn()}
      onSectionChange={setSection}
      onUpdateCalendar={vi.fn()}
      open
      section={section}
      userId="owner"
      {...props}
    />
  );
}

it("lists the sections in order, with Announcements only for admins", () => {
  const { rerender } = render(<Harness initial="general" />);
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  const nav = within(dialog).getByRole("tablist", { name: "Settings sections" });
  expect(within(nav).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "General",
    "Calendars",
    "Connections",
    "Account",
    "About",
  ]);
  rerender(<Harness initial="general" isAdmin />);
  expect(within(nav).getAllByRole("tab").map((tab) => tab.textContent)).toContain("Announcements");
});

it("opens at the requested section and switches without leaving the window", async () => {
  const user = userEvent.setup();
  render(<Harness initial="calendars" />);
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  expect(within(dialog).getByRole("tab", { name: "Calendars" }).getAttribute("aria-selected")).toBe("true");
  expect(within(dialog).getByRole("heading", { level: 2, name: "Calendars" })).toBeTruthy();
  await user.click(within(dialog).getByRole("tab", { name: "General" }));
  expect(await within(dialog).findByRole("radiogroup", { name: "Theme" })).toBeTruthy();
  expect(within(dialog).getByRole("heading", { level: 2, name: "General" })).toBeTruthy();
});

it("falls back to General when the admin section is not available", () => {
  render(<Harness initial="admin" />);
  expect(screen.getByRole("heading", { level: 2, name: "General" })).toBeTruthy();
});

it("shows a load failure in General with a retry", async () => {
  const user = userEvent.setup();
  const onLoadSettings = vi.fn().mockRejectedValueOnce(new Error("Not Found")).mockResolvedValue(DOCUMENT);
  render(<Harness initial="general" onLoadSettings={onLoadSettings} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Settings could not be loaded.");
  expect(alert.textContent).not.toContain("Not Found");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("radiogroup", { name: "Theme" })).toBeTruthy();
});

it("saves the default event calendar and resets it to null using the saved revision", async () => {
  const user = userEvent.setup();
  const saved = { ...DOCUMENT, revision: 2, value: { ...DOCUMENT.value, defaultEventCalendarId: "studio" } };
  const reset = { ...saved, revision: 3, value: { ...saved.value, defaultEventCalendarId: null } };
  const onPatchSettings = vi.fn<SettingsWindowProps["onPatchSettings"]>().mockResolvedValueOnce(saved).mockResolvedValueOnce(reset);
  render(<Harness initial="general" onPatchSettings={onPatchSettings} />);
  const select = await screen.findByRole("combobox", { name: "Default event calendar" });
  expect(select.textContent).toContain("Automatic");
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "Studio" }));
  await waitFor(() => expect(onPatchSettings).toHaveBeenCalledExactlyOnceWith({ baseRevision: 1, patch: { defaultEventCalendarId: "studio" } }));
  await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false));
  expect(select.textContent).toContain("Studio");
  await user.click(select);
  await user.click(screen.getByRole("option", { name: "Automatic" }));
  await waitFor(() => expect(onPatchSettings).toHaveBeenNthCalledWith(2, { baseRevision: 2, patch: { defaultEventCalendarId: null } }));
  await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false));
  expect(onPatchSettings).toHaveBeenCalledTimes(2);
  expect(select.textContent).toContain("Automatic");
});

it("offers writable event calendars but excludes read-only and task-only calendars", async () => {
  const user = userEvent.setup();
  const calendars = [
    ...fixtureCalendars,
    { ...fixtureCalendars[1]!, id: "read-only", name: "Read-only calendar", role: "viewer" },
    { ...fixtureCalendars[1]!, id: "tasks", name: "Task list", supportsEvents: false, supportsTasks: true },
  ];
  const onPatchSettings = vi.fn();
  render(<Harness initial="general" calendars={calendars} onPatchSettings={onPatchSettings} />);
  await user.click(await screen.findByRole("combobox", { name: "Default event calendar" }));
  const list = within(screen.getByRole("listbox", { name: "Default event calendar options" }));
  expect(list.getByRole("option", { name: "Personal" })).toBeTruthy();
  expect(list.getByRole("option", { name: "Studio" })).toBeTruthy();
  expect(list.queryByRole("option", { name: "Read-only calendar" })).toBeNull();
  expect(list.queryByRole("option", { name: "Task list" })).toBeNull();
  expect(onPatchSettings).not.toHaveBeenCalled();
});
