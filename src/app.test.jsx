// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import App from "./App.jsx";
import { downloadApiFile } from "./api.js";
import { enabledNavigationItems, enabledRibbonActions, VERSION_1_NAVIGATION } from "./navigation.js";
import { assertNoForbiddenImports, findForbiddenImports } from "./exclusionGuard.js";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  delete window.__signguyWorkspaceCanLeave;
  delete window.__signguyWorkspaceBypassHash;
  delete window.__signguyWorkspaceFocusTarget;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__signguyWorkspaceCanLeave;
  delete window.__signguyWorkspaceBypassHash;
  delete window.__signguyWorkspaceFocusTarget;
});

const tenant = {
  company_name: "Acme Signs",
  logo_reference: "logo.png",
  address: { line1: "1 Main", line2: "", city: "Raleigh", state: "NC", postal_code: "27601", country: "US" },
  contact_email: "shop@example.com",
  contact_phone: "555-0100",
  sales_tax_rate_basis_points: 725,
  locale: "en-US",
  currency: "USD",
  shop_timezone: "America/New_York",
};

const customer = { id: "customer-1", contact_name: "Avery Customer" };
const customerDetail = {
  ...customer,
  business_name: "Avery Signs",
  email: "avery@example.com",
  phone: "555-0188",
  tax_exempt: false,
  billing_address: { line1: "1 Main", line2: "", city: "Raleigh", state: "NC", postal_code: "27601", country: "US" },
};
const users = [
  { id: "user-1", display_name: "Owner User", email: "owner@example.com", role: "owner", active: true },
  { id: "user-2", display_name: "Staff User", email: "staff@example.com", role: "staff", active: true },
];
const workspaceOrder = {
  id: "order-1",
  order_number: "O-00001",
  customer_id: "customer-1",
  document_date: "2026-08-20",
  due_date: "2026-08-25",
  status: "active",
  discount_cents: 0,
  subtotal_cents: 1500,
  tax_cents: 0,
  total_cents: 1500,
  updated_at: "2026-08-20T21:00:00.000Z",
  production_progress: { completed: 0, total: 1, percent: 0 },
  invoice: null,
  internal_notes: "",
  items: [{
    id: "item-1",
    description: "Installed panel",
    quantity_decimal: "1",
    unit_price_cents: 1500,
    line_total_cents: 1500,
    taxable: true,
    production_required: true,
    production_stage: "not_started",
    completed: false,
    due_date: "2026-08-25",
    assigned_user_id: "user-2",
    internal_note: "",
  }],
};
const calendarEvent = {
  id: "calendar-1",
  title: "Install appointment",
  order_id: "order-1",
  order_item_id: "item-1",
  order_number: "O-00001",
  item_description: "Installed panel",
  start_at: "2026-08-21T13:00:00.000Z",
  end_at: "2026-08-21T14:00:00.000Z",
  local_start_date: "2026-08-21",
  local_end_date: "2026-08-21",
  local_start_time: "09:00 AM",
  local_end_time: "10:00 AM",
  all_day: false,
  assigned_user_id: "user-2",
  assigned_user_name: "Staff User",
  status: "scheduled",
};

function jsonResponse(data) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
}

function storedSession(role = "owner") {
  return {
    access_token: "token",
    user: { id: `${role}-user`, role },
    tenant,
  };
}

function mockAuthenticatedApp({ role = "owner", route = "/orders" } = {}) {
  localStorage.setItem("signguySlimSession", JSON.stringify(storedSession(role)));
  window.location.hash = route;
  const fetch = vi.fn((url, options = {}) => {
    if (url === "/api/auth/me") return Promise.resolve(jsonResponse(storedSession(role)));
    if (url === "/api/customers") return Promise.resolve(jsonResponse({ items: [customer] }));
    if (url === "/api/settings") return Promise.resolve(jsonResponse({ tenant, users }));
    if (String(url).startsWith("/api/dashboard")) return Promise.resolve(jsonResponse({
      timezone: "America/New_York",
      production: { stages: ["not_started", "ready", "in_progress", "waiting", "complete"].map((stage) => ({ stage, label: stage.replace(/_/g, " "), count: stage === "not_started" ? 1 : 0, items: stage === "not_started" ? [{ ...workspaceOrder.items[0], order_id: "order-1", order_number: "O-00001", due_date: "2026-08-25" }] : [] })) },
      calendar: { start_date: "2026-08-21", end_date: "2026-09-03", days: ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"].map((date, index) => ({ date, today: index === 0, events: index === 0 ? [calendarEvent] : [] })) },
      attention: [{ source_type: "invoice", source_id: "invoice-1", reason: "payment_attention", title: "I-00001", severity: "payment attention", link: "#/invoices" }],
    }));
    if (url === "/api/orders") return Promise.resolve(jsonResponse({ items: [workspaceOrder] }));
    if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({ order: workspaceOrder, customer: customerDetail, users, attachments: [{ id: "attachment-1", original_filename: "proof.txt", mime_type: "text/plain", byte_size: 5, sha256: "abcdef1234567890", previewable: true }] }));
    if (url === "/api/orders/order-1/attachments") return Promise.resolve(jsonResponse({ items: [{ id: "attachment-1", original_filename: "proof.txt", mime_type: "text/plain", byte_size: 5, sha256: "abcdef1234567890", previewable: true }] }));
    if (url === "/api/orders/order-1/attachments/attachment-1/preview") return Promise.resolve({
      ok: true,
      headers: new Headers({ "content-type": "text/plain", "content-disposition": "inline; filename=\"proof.txt\"" }),
      blob: async () => new Blob(["proof"], { type: "text/plain" }),
    });
    if (url === "/api/orders/order-1/attachments/attachment-1/download") return Promise.resolve({
      ok: true,
      headers: new Headers({ "content-type": "text/plain", "content-disposition": "attachment; filename=\"proof.txt\"" }),
      blob: async () => new Blob(["proof"], { type: "text/plain" }),
    });
    if (url === "/api/production/board") return Promise.resolve(jsonResponse({ stages: ["not_started", "ready", "in_progress", "waiting", "complete"], users, items: [{
      ...workspaceOrder.items[0],
      order_id: "order-1",
      order_number: "O-00001",
      customer_name: "Avery Signs",
      assigned_user: users[1],
      late: false,
      production_progress: workspaceOrder.production_progress,
    }] }));
    if (url === "/api/production/items/item-1/stage") return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/production/items/item-1/completion") return Promise.resolve(jsonResponse({ ok: true }));
    if (String(url).startsWith("/api/calendar") && (!options || options.method === "GET" || !options.method)) return Promise.resolve(jsonResponse({ items: [calendarEvent], users, timezone: "America/New_York" }));
    if (url === "/api/calendar") return Promise.resolve(jsonResponse({ ...calendarEvent, id: "calendar-2" }));
    if (url === "/api/calendar/calendar-1") return Promise.resolve(jsonResponse(calendarEvent));
    if (url === "/api/calendar/calendar-1/complete") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "complete" }));
    if (url === "/api/calendar/calendar-1/reopen") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "scheduled" }));
    if (url === "/api/calendar/calendar-1/cancel") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "cancelled" }));
    if (url === "/api/estimates") return Promise.resolve(jsonResponse({ items: [{ id: "estimate-1", estimate_number: "E-00001", status: "draft", total_cents: 1500 }] }));
    if (url === "/api/estimates/estimate-1") return Promise.resolve(jsonResponse({
      id: "estimate-1",
      customer_id: "customer-1",
      document_date: "2026-08-20",
      expires_at: "",
      follow_up_at: "",
      status: "draft",
      discount_cents: 0,
      internal_notes: "",
      items: [{
        description: "Installed panel",
        quantity_decimal: "1",
        unit_price_cents: 1500,
        taxable: true,
        production_required: false,
        due_date: null,
        assigned_user_id: null,
        internal_note: null,
      }],
    }));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Version 1 navigation boundary", () => {
  it("renders completed Part 4 routes and keeps later parts hidden", () => {
    expect(enabledNavigationItems().map((item) => item.key)).toEqual([
      "home",
      "customers",
      "estimates",
      "orders",
      "production",
      "calendar",
      "invoices",
      "settings",
    ]);
  });

  it("keeps the locked Version 1 navigation set without Version 2 sections", () => {
    expect(VERSION_1_NAVIGATION.map((item) => item.label)).toEqual([
      "Home",
      "Customers",
      "Estimates",
      "Orders",
      "Production",
      "Calendar",
      "Invoices",
      "Settings",
    ]);
  });

  it("enables complete ribbon actions only for implemented Version 1 workflows", () => {
    expect(enabledRibbonActions().map((action) => action.key)).toEqual([
      "new-customer",
      "new-estimate",
      "new-order",
      "schedule-job",
      "open-calendar",
      "open-production",
      "new-invoice",
      "calculator",
    ]);
  });
});

describe("Part 2 UI", () => {
  it("keeps Quick Entry description focus and value while typing", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    const description = await screen.findByLabelText("Description");
    description.focus();
    let value = "";
    for (const character of "Channel letters") {
      value += character;
      fireEvent.change(description, { target: { value } });
      expect(document.activeElement).toBe(description);
    }

    expect(description.value).toBe("Channel letters");
  });

  it("preserves Quick Entry item identity through add, duplicate, reorder, edit, and remove", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    const firstDescription = await screen.findByLabelText("Description");
    fireEvent.change(firstDescription, { target: { value: "Banner" } });
    fireEvent.click(screen.getByText("Item"));
    expect(screen.getAllByLabelText("Description").map((input) => input.value)).toEqual(["Banner", ""]);

    fireEvent.click(screen.getAllByTitle("Duplicate")[0]);
    expect(screen.getAllByLabelText("Description").map((input) => input.value)).toEqual(["Banner", "Banner", ""]);

    fireEvent.change(screen.getAllByLabelText("Description")[1], { target: { value: "Banner Copy" } });
    fireEvent.click(screen.getAllByTitle("Move down")[1]);
    expect(screen.getAllByLabelText("Description").map((input) => input.value)).toEqual(["Banner", "", "Banner Copy"]);

    fireEvent.change(screen.getAllByLabelText("Description")[2], { target: { value: "Banner Copy Updated" } });
    fireEvent.click(screen.getAllByTitle("Remove")[0]);
    expect(screen.getAllByLabelText("Description").map((input) => input.value)).toEqual(["", "Banner Copy Updated"]);
  });

  it("enables the Estimate customer selector for creation and disables it for editing", async () => {
    mockAuthenticatedApp({ route: "/estimates" });
    render(<App />);

    expect((await screen.findByLabelText("Customer")).disabled).toBe(false);
    fireEvent.click(await screen.findByText("Edit"));

    expect(await screen.findByText("Estimate customer is locked after creation.")).toBeTruthy();
    expect(screen.getByLabelText("Customer").disabled).toBe(true);
  });

  it.each(["owner", "admin"])("shows enabled company settings controls and Save Settings for %s", async (role) => {
    mockAuthenticatedApp({ role, route: "/settings" });
    render(<App />);

    expect((await screen.findByLabelText("Company name")).disabled).toBe(false);
    expect(screen.getByText("Save Settings").closest("button").disabled).toBe(false);
    expect(screen.getByText("Add User")).toBeTruthy();
  });

  it.each(["manager", "staff"])("shows read-only company settings and no enabled save/user-management controls for %s", async (role) => {
    mockAuthenticatedApp({ role, route: "/settings" });
    render(<App />);

    expect((await screen.findByLabelText("Company name")).disabled).toBe(true);
    expect(screen.queryByText("Save Settings")).toBeNull();
    expect(screen.queryByText("Add User")).toBeNull();
    expect(screen.getByText("Owner User")).toBeTruthy();
    expect(screen.getByText("Staff User")).toBeTruthy();
  });

  it.each([
    ["malformed", "{bad json"],
    ["obsolete", JSON.stringify({ access_token: "token", user: {}, tenant: {} })],
  ])("clears %s stored sessions and returns to login", async (_label, storedValue) => {
    localStorage.setItem("signguySlimSession", storedValue);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<App />);

    expect(await screen.findByText("Continue")).toBeTruthy();
    expect(localStorage.getItem("signguySlimSession")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens the Order Workspace from the Orders list and shows customer summary links", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    const open = await screen.findByText("Open");
    fireEvent.click(open);

    expect(await screen.findByText("Order Workspace")).toBeTruthy();
    expect(screen.getAllByText("O-00001").length).toBeGreaterThan(1);
    expect(screen.getByText("Avery Signs")).toBeTruthy();
    expect(screen.getByText("avery@example.com").closest("a").getAttribute("href")).toBe("mailto:avery@example.com");
    expect(screen.getByText("555-0188").closest("a").getAttribute("href")).toBe("tel:555-0188");
  });

  it("opens the Order Workspace from a deep link and confirms unsaved close", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByText("Order Workspace")).toBeTruthy();
    const notes = screen.getAllByLabelText("Internal notes");
    fireEvent.change(notes.at(-1), { target: { value: "Needs proof" } });
    fireEvent.click(screen.getByText("Close"));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved Order Workspace changes?");
    expect(screen.getByText("Order Workspace")).toBeTruthy();
  });

  it("shows invoiced Order financial locks in the workspace", async () => {
    localStorage.setItem("signguySlimSession", JSON.stringify(storedSession("owner")));
    window.location.hash = "/orders/order-1";
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (url === "/api/auth/me") return Promise.resolve(jsonResponse(storedSession("owner")));
      if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({
        order: { ...workspaceOrder, invoice: { id: "invoice-1", invoice_number: "I-00001" } },
        customer: customerDetail,
        users,
        attachments: [],
      }));
      return Promise.resolve(jsonResponse({ items: [] }));
    }));
    render(<App />);

    expect(await screen.findByText(/Financial fields and item order are locked/)).toBeTruthy();
    expect(screen.getAllByLabelText("Description").at(-1).disabled).toBe(true);
    expect(screen.getAllByLabelText("Production").at(-1).disabled).toBe(false);
  });

  it("surfaces stale workspace conflicts with a Reload action", async () => {
    localStorage.setItem("signguySlimSession", JSON.stringify(storedSession("owner")));
    window.location.hash = "/orders/order-1";
    const fetch = vi.fn((url, options = {}) => {
      if (url === "/api/auth/me") return Promise.resolve(jsonResponse(storedSession("owner")));
      if (url === "/api/orders/order-1/workspace" && options.method === "PATCH") return Promise.resolve({
        ok: false,
        status: 409,
        statusText: "Conflict",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "order_conflict" }),
      });
      if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({ order: workspaceOrder, customer: customerDetail, users, attachments: [] }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });
    vi.stubGlobal("fetch", fetch);
    render(<App />);

    const notes = await screen.findAllByLabelText("Internal notes");
    fireEvent.change(notes.at(-1), { target: { value: "Changed" } });
    fireEvent.click(screen.getByText("Save Workspace"));

    expect(await screen.findByText(/Order changed elsewhere/)).toBeTruthy();
    expect(screen.getByText("Reload")).toBeTruthy();
  });

  it("moves production items with non-drag controls and marks Done/Reopen without showing prices", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    expect(await screen.findByText("Installed panel")).toBeTruthy();
    expect(screen.queryByText("$15.00")).toBeNull();
    fireEvent.change(screen.getByLabelText("Move Installed panel to stage"), { target: { value: "ready" } });
    fireEvent.click(await screen.findByText("Done"));

    expect(fetch).toHaveBeenCalledWith("/api/production/items/item-1/stage", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("/api/production/items/item-1/completion", expect.objectContaining({ method: "POST" }));
  });

  it("moves production items with native drag and drop", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    const card = (await screen.findByText("Installed panel")).closest("article");
    const readyColumn = screen.getAllByText("Ready").find((node) => node.tagName === "H3").closest("section");
    const dataTransfer = {
      value: "",
      setData(_type, value) { this.value = value; },
      getData() { return this.value; },
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(readyColumn, { dataTransfer });

    expect(fetch).toHaveBeenCalledWith("/api/production/items/item-1/stage", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ stage: "ready" }),
    }));
  });

  it("renders the compact Home dashboard with production, rolling calendar, and attention areas", async () => {
    mockAuthenticatedApp({ route: "/" });
    render(<App />);

    expect(await screen.findByText("Mini Production Board")).toBeTruthy();
    expect(screen.getByText("Rolling Two-Week Calendar")).toBeTruthy();
    expect(screen.getByText("Attention Panel")).toBeTruthy();
    expect(screen.getByText("Open Full Calendar").closest("a").getAttribute("href")).toBe("#/calendar");
    expect(screen.getAllByText("Install appointment").length).toBeGreaterThan(0);
    expect(screen.getByText(/payment attention/)).toBeTruthy();
  });

  it("supports Calendar Month, Week, Day, Agenda views, filters, links, and status actions", async () => {
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Calendar", level: 1 })).toBeTruthy();
    expect(screen.getByText("Install appointment")).toBeTruthy();
    fireEvent.click(screen.getByText("week"));
    fireEvent.click(screen.getByText("day"));
    fireEvent.click(screen.getByText("agenda"));
    fireEvent.change(screen.getByLabelText("Assigned user filter"), { target: { value: "user-2" } });
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "scheduled" } });
    fireEvent.change(screen.getByLabelText("Linked record filter"), { target: { value: "order_item" } });
    fireEvent.click(await screen.findByRole("button", { name: /Complete/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar/calendar-1/complete", expect.objectContaining({ method: "POST" })));
    expect(screen.getAllByText("O-00001").find((node) => node.closest("a"))?.closest("a").getAttribute("href")).toBe("#/orders/order-1");
  });

  it("creates and reschedules Calendar events from the accessible form", async () => {
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "New survey" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-08-22T09:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-08-22T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Event/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar", expect.objectContaining({ method: "POST" })));

    fireEvent.click(await screen.findByText("Install appointment"));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-08-23T09:00" } });
    fireEvent.click(screen.getByText("Save Event"));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar/calendar-1", expect.objectContaining({ method: "PATCH" })));
  });

  it("schedules from the Order Workspace without discarding dirty fields", async () => {
    const fetch = mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Fields");
    const dialog = screen.getByRole("dialog", { name: /O-00001/ });
    const notes = within(dialog).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Unsaved workspace note" } });
    fireEvent.click(screen.getByText("Schedule Order"));
    const scheduleDialog = screen.getByRole("dialog", { name: "Schedule from Order Workspace" });
    fireEvent.change(within(scheduleDialog).getByLabelText("Title"), { target: { value: "Scheduled order" } });
    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar", expect.objectContaining({ method: "POST" })));
    expect(notes.value).toBe("Unsaved workspace note");
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/orders/order-1/workspace" && options?.method === "PATCH")).toBe(false);
  });

  it("previews and downloads attachments with authenticated Blob requests and revokes object URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:proof");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const fetch = mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    fireEvent.click(await screen.findByText("Preview"));
    expect(await screen.findByText("Close Preview")).toBeTruthy();
    fireEvent.click(screen.getByText("Close Preview"));
    fireEvent.click(screen.getByText("Download"));

    expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments/attachment-1/preview", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments/attachment-1/download", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:proof");
  });

  it("preserves dirty Workspace fields while uploading and deleting attachments", async () => {
    localStorage.setItem("signguySlimSession", JSON.stringify(storedSession("owner")));
    window.location.hash = "/orders/order-1";
    const fetch = vi.fn((url, options = {}) => {
      if (url === "/api/auth/me") return Promise.resolve(jsonResponse(storedSession("owner")));
      if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({ order: workspaceOrder, customer: customerDetail, users, attachments: [{ id: "attachment-1", original_filename: "proof.txt", mime_type: "text/plain", byte_size: 5, sha256: "abcdef1234567890", previewable: true }] }));
      if (url === "/api/orders/order-1/attachments" && options.method === "POST") return Promise.resolve(jsonResponse({ id: "attachment-2", original_filename: "new.txt" }));
      if (url === "/api/orders/order-1/attachments") return Promise.resolve(jsonResponse({ items: [{ id: "attachment-1", original_filename: "proof.txt", mime_type: "text/plain", byte_size: 5, sha256: "abcdef1234567890", previewable: true }, { id: "attachment-2", original_filename: "new.txt", mime_type: "text/plain", byte_size: 3, sha256: "123456abcdef", previewable: true }] }));
      if (url === "/api/orders/order-1/attachments/attachment-1") return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<App />);

    await screen.findByText("Order Fields");
    const dialog = screen.getByRole("dialog", { name: /O-00001/ });
    const notes = within(dialog).getByLabelText("Internal notes");
    const description = within(dialog).getByLabelText("Description");
    fireEvent.change(notes, { target: { value: "Unsaved note" } });
    fireEvent.change(description, { target: { value: "Unsaved item" } });
    fireEvent.change(screen.getByLabelText("Upload attachment"), { target: { files: [new File(["new"], "new.txt", { type: "text/plain" })] } });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments", expect.objectContaining({ method: "POST" })));
    expect(notes.value).toBe("Unsaved note");
    expect(description.value).toBe("Unsaved item");
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments/attachment-1", expect.objectContaining({ method: "DELETE" })));
    expect(notes.value).toBe("Unsaved note");
    expect(description.value).toBe("Unsaved item");
    expect(fetch.mock.calls.filter(([url]) => url === "/api/orders/order-1/workspace")).toHaveLength(1);
  });

  it("makes background content inert and traps focus inside the Workspace", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByText("Order Workspace")).toBeTruthy();
    expect(document.querySelector(".sidebar").hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".workspace").hasAttribute("inert")).toBe(true);
    const save = screen.getByText("Save Workspace").closest("button");
    save.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Schedule Order"));
  });

  it("guards dirty hash navigation and restores the Workspace route when cancelled", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Fields");
    const dialog = screen.getByRole("dialog", { name: /O-00001/ });
    const notes = within(dialog).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Unsaved note" } });
    await screen.findByText(/Unsaved/);
    window.location.hash = "#/production";
    fireEvent(window, new HashChangeEvent("hashchange"));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("Discard unsaved Order Workspace changes?"));
    await waitFor(() => expect(window.location.hash).toBe("#/orders/order-1"));
    expect(screen.getByText("Order Workspace")).toBeTruthy();
  });

  it("asks exactly once when dirty Close is confirmed and returns to Orders", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Fields");
    const dialog = screen.getByRole("dialog", { name: /O-00001/ });
    fireEvent.change(within(dialog).getByLabelText("Internal notes"), { target: { value: "Needs proof" } });
    await screen.findByText(/Unsaved/);
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("asks exactly once when dirty Escape close is canceled and preserves values", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Fields");
    const dialog = screen.getByRole("dialog", { name: /O-00001/ });
    const notes = within(dialog).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Still editing" } });
    await screen.findByText(/Unsaved/);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/orders/order-1");
    expect(notes.value).toBe("Still editing");
    expect(screen.getByText("Order Workspace")).toBeTruthy();
  });

  it("closes a clean Workspace without confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Fields");
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returns focus to the matching Orders Open button after close", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    const open = await screen.findByText("Open");
    fireEvent.click(open);
    await screen.findByText("Order Fields");
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    await waitFor(() => expect(document.activeElement?.dataset.focusTarget).toBe("order-open-order-1"));
  });

  it("returns to Production when the Workspace was opened from Production", async () => {
    mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    fireEvent.click(await screen.findByText("Open Order"));
    expect(await screen.findByText("Order Workspace")).toBeTruthy();
    expect(screen.getByText("Return: Production")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(window.location.hash).toBe("#/production"));
  });

  it("returns focus to the matching Production Open Order button after close", async () => {
    mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    fireEvent.click(await screen.findByText("Open Order"));
    await screen.findByText("Order Fields");
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(window.location.hash).toBe("#/production"));
    await waitFor(() => expect(document.activeElement?.dataset.focusTarget).toBe("production-open-order-item-1"));
  });

  it("revokes an attachment preview Blob URL when the Workspace unmounts", async () => {
    const createObjectURL = vi.fn(() => "blob:open-preview");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    mockAuthenticatedApp({ route: "/orders/order-1" });
    const view = render(<App />);

    fireEvent.click(await screen.findByText("Preview"));
    expect(await screen.findByText("Close Preview")).toBeTruthy();
    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:open-preview");
  });

  it("renders calculator arithmetic and copy-only workflow", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    fireEvent.click(screen.getByText("Register"));
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "password123" } });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        access_token: "token",
        user: { role: "owner" },
        tenant: { company_name: "Acme Signs" },
      }),
    });
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("New Customer")).toBeTruthy();
    fireEvent.click(screen.getByText("Calculator"));
    fireEvent.click(screen.getByText("7"));
    fireEvent.click(screen.getByText("+"));
    fireEvent.click(screen.getByText("8"));
    fireEvent.click(screen.getByText("="));
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("Copy Result")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("downloads Estimate PDFs through authenticated Blob API calls", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    fireEvent.click(await screen.findByText("Register"));
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "password123" } });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        access_token: "token",
        user: { role: "owner" },
        tenant: { company_name: "Acme Signs" },
      }),
    });
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(await screen.findByText("New Estimate"));
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ items: [] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ users: [] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ items: [{ id: "estimate-1", estimate_number: "E-00001", status: "draft", total_cents: 1200 }] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => new Blob(["pdf"], { type: "application/pdf" }),
    });
    fireEvent.click(await screen.findByText("PDF"));
    expect(fetch).toHaveBeenLastCalledWith("/api/estimates/estimate-1/pdf", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    vi.unstubAllGlobals();
  });

  it("creates and revokes object URLs for authenticated API file downloads", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => new Blob(["pdf"], { type: "application/pdf" }),
    });
    const createObjectURL = vi.fn(() => "blob:invoice");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetch);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await downloadApiFile("/invoices/invoice-1/pdf", { token: "token", filename: "I-00001.pdf" });
    expect(fetch).toHaveBeenCalledWith("/api/invoices/invoice-1/pdf", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    expect(createObjectURL).toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:invoice");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("excluded import guard", () => {
  it("flags full-MVP and future-module imports", () => {
    expect(findForbiddenImports('import TimeClock from "@/pages/TimeClockPage.jsx";')).toHaveLength(1);
  });

  it("flags dynamic imports and CommonJS require calls", () => {
    expect(findForbiddenImports('const mod = await import("@/pages/PricingCalculatorPage.jsx");').length).toBeGreaterThan(0);
    expect(findForbiddenImports('const mod = require("@/pages/EmployeePortal.jsx");').length).toBeGreaterThan(0);
  });

  it("passes ordinary Slim source imports", () => {
    expect(assertNoForbiddenImports('import App from "./App.jsx";')).toBe(true);
  });

  it("uses explicit dependency versions and keeps tooling in devDependencies", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(Object.values({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain("latest");
    expect(pkg.dependencies.bcryptjs).toBe("3.0.3");
    expect(pkg.dependencies.zod).toBe("4.4.3");
    expect(pkg.dependencies).not.toHaveProperty("vite");
    expect(pkg.dependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(pkg.devDependencies).toHaveProperty("vite", "8.2.2");
    expect(pkg.engines).toEqual({ node: "24.16.0", npm: "11.13.0" });
  });
});
