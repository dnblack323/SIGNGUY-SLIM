// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import App from "./App.jsx";
import { downloadApiFile } from "./api.js";
import { enabledNavigationItems, enabledOperationalAreas, filterNavigationForRole, getRouteContext, VERSION_1_NAVIGATION } from "./navigation.js";
import { assertNoForbiddenImports, findForbiddenImports } from "./exclusionGuard.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  delete window.__signguyWorkspaceCanLeave;
  delete window.__signguyWorkspaceBypassHash;
  delete window.__signguyWorkspaceFocusTarget;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
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

function pinCalendarTestDate() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
}

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
  { id: "user-3", display_name: "Manager User", email: "manager@example.com", role: "manager", active: true },
];
const employee = {
  id: "employee-1",
  user_id: "user-2",
  employee_number: "EMP-0001",
  name: "Staff User",
  email: "staff@example.com",
  phone: "555-0199",
  role: "staff",
  portal_access_enabled: true,
  pay_management_enabled: false,
  active: true,
  hire_date: "2026-08-15",
  current_rate_cents: 1800,
  current_rate_effective_date: "2026-08-15",
};
const payWeek = {
  id: "pay-week-1",
  employee_id: "employee-1",
  week_start_date: "2026-08-15",
  week_end_date: "2026-08-21",
  payday_date: "2026-08-21",
  status: "open",
  opening_carryover_cents: 0,
  valid_minutes: 120,
  valid_hours_decimal: "2.00",
  gross_pay_cents: 3600,
  positive_adjustments_cents: 250,
  negative_adjustments_cents: 0,
  advances_cents: 500,
  manual_payments_cents: 1000,
  estimated_amount_due_cents: 2350,
  closing_carryover_cents: null,
  rate_breakdown: [{ hourly_rate_cents: 1800, minutes: 120, hours_decimal: "2.00", gross_pay_cents: 3600 }],
  label: "Internal Pay Summary",
};
const closedTimeEntry = {
  id: "time-entry-1",
  employee_id: "employee-1",
  clock_in_at: "2026-08-16T12:00:00.000Z",
  clock_out_at: "2026-08-16T14:00:00.000Z",
  clock_in_display: "2026-08-16 08:00",
  clock_out_display: "2026-08-16 10:00",
  duration_minutes: 120,
  status: "closed",
  implausible: false,
};
const openTimeEntry = {
  ...closedTimeEntry,
  id: "time-entry-open",
  clock_out_at: null,
  clock_out_display: "",
  duration_minutes: 0,
  status: "open",
  employee_name: "Staff User",
};
const timeSummary = {
  employee,
  timezone: "America/New_York",
  week: payWeek,
  open_entry: null,
  entries: [closedTimeEntry],
  current_week_total_minutes: 120,
  current_week_total_hours_decimal: "2.00",
  clocked_in: [openTimeEntry],
};
const payDetail = {
  employee,
  week: payWeek,
  advances: [{ id: "advance-1", amount_cents: 500, note: "Materials", voided: false }],
  adjustments: [{ id: "adjustment-1", amount_cents: 250, direction: "positive", reason: "Bonus", voided: false }],
  manual_payments: [{ id: "manual-payment-1", amount_cents: 1000, method: "cash", voided: false }],
  formula: "Estimated Amount Due = Opening Carryover + Gross Pay + Positive Adjustments - Negative Adjustments - Advances - Manual Payments",
};
const announcement = {
  id: "announcement-1",
  title: "Shop Meeting",
  body: "Meet at 8 before installs.",
  publish_at: "2026-08-21T12:00:00.000Z",
  expires_at: null,
  audience_role: "all",
  author_name: "Owner User",
  unread: true,
  read_at: null,
};
const readAnnouncement = { ...announcement, unread: false, read_at: "2026-08-21T12:15:00.000Z" };
const scheduledAnnouncement = { ...announcement, id: "announcement-scheduled", title: "Scheduled Notice", publish_at: "2099-08-21T12:00:00.000Z" };
const expiredAnnouncement = { ...announcement, id: "announcement-expired", title: "Expired Notice", publish_at: "2020-08-21T12:00:00.000Z", expires_at: "2020-08-22T12:00:00.000Z" };
const archivedAnnouncement = { ...announcement, id: "announcement-archived", title: "Archived Notice", archived_at: "2026-08-22T12:00:00.000Z" };
const conversation = {
  user_id: "user-1",
  display_name: "Owner User",
  unread_count: 1,
  last_message: {
    id: "message-1",
    body: "Can you check this order?",
    sent_at: "2026-08-21T12:00:00.000Z",
  },
};
const messageThread = {
  participant: { user_id: "user-1", display_name: "Owner User", employee_id: "employee-owner", role: "owner" },
  messages: [
    { id: "message-1", sender_user_id: "user-1", recipient_user_id: "user-2", sender_name: "Owner User", recipient_name: "Staff User", body: "Can you check this order?", sent_at: "2026-08-21T12:00:00.000Z", recipient_read_at: null, direction: "received", unread: true },
  ],
};
const managerThread = {
  participant: { user_id: "user-3", display_name: "Manager User", employee_id: "employee-manager", role: "manager" },
  messages: [
    { id: "message-3", sender_user_id: "user-3", recipient_user_id: "user-2", sender_name: "Manager User", recipient_name: "Staff User", body: "Please check install timing.", sent_at: "2026-08-21T13:00:00.000Z", recipient_read_at: null, direction: "received", unread: true },
  ],
};
const currentBackupPreview = {
  backup_id: "sgp_v1_backup_current",
  created_at_utc: "2026-08-31T12:00:00.000Z",
  source_product: "SIGNGUY-SLIM",
  source_application_version: "0.2.0-v2-stage8",
  source_schema_version: "013_v2_stage7_8_messages_announcements.sql",
  counts: {
    tenants: 1,
    users: 2,
    customers: 1,
    estimates: 1,
    estimate_items: 2,
    orders: 1,
    order_items: 2,
    work_orders: 1,
    work_order_items: 1,
    invoices: 1,
    calendar_events: 1,
    employees: 1,
    employee_rates: 1,
    employee_time_entries: 2,
    employee_pay_weeks: 1,
    employee_pay_advances: 1,
    employee_pay_adjustments: 1,
    employee_pay_manual_payments: 1,
    employee_announcements: 0,
    employee_announcement_reads: 0,
    employee_direct_messages: 0,
    tenant_sequences: 5,
    reminders: 0,
    notes: 0,
    audit_events: 8,
    attachments: 1,
  },
  attachment_count: 1,
  total_attachment_bytes: 128,
  user_mapping: [],
  warnings: [],
  blocking_errors: [],
  restore_permitted: true,
};
const workspaceOrder = {
  id: "order-1",
  order_number: "O-00001",
  title: "Avery Lobby Sign",
  customer_id: "customer-1",
  customer_summary: { contact_name: "Avery Customer", business_name: "Avery Signs" },
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
  sent_to_production_at: null,
  production_grouping_mode: null,
  bundles: [],
  work_orders: [],
  items: [{
    id: "item-1",
    title: "Installed panel",
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
const workOrder = {
  id: "work-order-1",
  record_type: "work_order",
  work_order_number: "WO-00001",
  title: "Avery Lobby Sign",
  order_id: "order-1",
  order_number: "O-00001",
  order_title: "Avery Lobby Sign",
  customer_name: "Avery Signs",
  item_count: 1,
  grouping_mode: "whole_order",
  production_stage: "not_started",
  completed: false,
  status: "active",
  due_date: "2026-08-25",
  assigned_user_id: "user-2",
  assigned_user: users[1],
  late: false,
  production_progress: { completed: 0, total: 1, percent: 0 },
  items: [{ id: "item-1", title: "Installed panel", description: "Installed panel", quantity_decimal: "1", production_stage: "not_started", completed: false }],
  scheduled_entries: [],
};
const calendarEvent = {
  id: "calendar-1",
  entry_type: "event",
  source_type: "event",
  schedule_category: "installation",
  department_id: "dept-install",
  department_name: "Installation",
  department_color: "#3F7FC4",
  derived: false,
  title: "Install appointment",
  order_id: "order-1",
  order_item_id: "item-1",
  work_order_id: null,
  order_number: "O-00001",
  order_title: "Avery Lobby Sign",
  item_title: "Installed panel",
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
  assignees: [{ user_id: "user-2", display_name: "Staff User", primary_assignee: true }],
  resource_reservations: [{ resource_id: "resource-1", name: "Bucket Truck", quantity: 1, resource_type: "vehicle" }],
  status: "scheduled",
};
const calendarProductionEvent = {
  ...calendarEvent,
  id: "calendar-production-1",
  entry_type: "event",
  source_type: "production",
  schedule_category: "production",
  department_id: null,
  department_name: null,
  title: "Production Run",
  start_at: "2026-08-26T18:00:00.000Z",
  end_at: "2026-08-26T19:00:00.000Z",
  local_start_date: "2026-08-26",
  local_end_date: "2026-08-26",
  local_start_time: "02:00 PM",
  local_end_time: "03:00 PM",
};
const calendarEmployeeEvent = {
  ...calendarEvent,
  id: "calendar-employee-1",
  entry_type: "event",
  source_type: "event",
  schedule_category: "general",
  title: "Employee Shift",
  start_at: "2026-08-20T15:00:00.000Z",
  end_at: "2026-08-20T16:00:00.000Z",
  local_start_date: "2026-08-20",
  local_end_date: "2026-08-20",
  local_start_time: "11:00 AM",
  local_end_time: "12:00 PM",
};
const calendarOverflowEvent = {
  ...calendarEvent,
  id: "calendar-overflow-1",
  title: "Overflow Schedule Check",
  start_at: "2026-08-21T20:00:00.000Z",
  end_at: "2026-08-21T21:00:00.000Z",
  local_start_date: "2026-08-21",
  local_end_date: "2026-08-21",
  local_start_time: "04:00 PM",
  local_end_time: "05:00 PM",
};
const calendarSalesEvent = {
  ...calendarEvent,
  id: "calendar-sales-1",
  entry_type: "appointment",
  source_type: "appointment",
  schedule_category: "sales",
  title: "Sales Meeting",
  start_at: "2026-08-22T14:00:00.000Z",
  end_at: "2026-08-22T15:00:00.000Z",
  local_start_date: "2026-08-22",
  local_end_date: "2026-08-22",
  local_start_time: "10:00 AM",
  local_end_time: "11:00 AM",
};
const calendarDeadlineEvent = {
  ...calendarEvent,
  id: "calendar-deadline-1",
  entry_type: "task",
  source_type: "deadline",
  schedule_category: "deadline",
  title: "Order deadline",
  start_at: "2026-08-27",
  end_at: "2026-08-28",
  local_start_date: "2026-08-27",
  local_end_date: "2026-08-27",
  local_start_time: null,
  local_end_time: null,
  all_day: true,
};
const calendarDepartments = [{ id: "dept-install", name: "Installation", color: "#3F7FC4", active: true, memberships: [{ user_id: "user-2", display_name: "Staff User", active: true, primary_department: true }] }];
const calendarResources = [{ id: "resource-1", name: "Bucket Truck", resource_type: "vehicle", capacity: 1, color: "#64748b", active: true }];
const calendarViews = [
  { id: "view-all", name: "All Shop Schedules", system_key: "all_shop", visibility: "shared", active: true, color: "#75638F", filters: {} },
  { id: "view-production", name: "Production Schedule", system_key: "production", visibility: "shared", active: true, color: "#7B3DA6", filters: { schedule_categories: ["production"] } },
  { id: "view-install", name: "Installation Schedule", system_key: "installation", visibility: "shared", active: true, color: "#3F7FC4", filters: { schedule_categories: ["installation"] } },
  { id: "view-appointments", name: "Customer Appointments", system_key: "customer_appointments", visibility: "shared", active: true, color: "#E06F00", filters: { schedule_categories: ["customer_appointment", "site_survey"], entry_types: ["appointment"] } },
];

function jsonResponse(data) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
}

function jsonError(status, data) {
  return {
    ok: false,
    status,
    statusText: data.error,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
}

function imageAttachment(overrides = {}) {
  return {
    id: "image-1",
    original_filename: "site-photo.png",
    mime_type: "image/png",
    byte_size: 68,
    sha256: "abcdef1234567890",
    previewable: true,
    annotatable: true,
    source_type: "upload",
    original_attachment_id: null,
    image_width: 100,
    image_height: 100,
    ...overrides,
  };
}

function mockCanvas({ blobText = "canvas-image" } = {}) {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(callback, type = "image/png") {
    callback(new Blob([blobText], { type }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 });
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1280 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 720 });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  return context;
}

function mockImageWorkspaceFetch({ attachments = [imageAttachment()], uploadResponse = imageAttachment({ id: "image-2", source_type: "device_capture" }) } = {}) {
  localStorage.setItem("signguySlimSession", JSON.stringify(storedSession("owner")));
  window.location.hash = "/orders/order-1";
  const fetch = vi.fn((url, options = {}) => {
    if (url === "/api/auth/me") return Promise.resolve(jsonResponse(storedSession("owner")));
    if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({ order: workspaceOrder, customer: customerDetail, users, attachments }));
    if (url === "/api/orders/order-1/attachments" && options.method === "POST") return Promise.resolve(jsonResponse(uploadResponse));
    if (url === "/api/orders/order-1/attachments") return Promise.resolve(jsonResponse({ items: [...attachments, uploadResponse] }));
    if (String(url).endsWith("/preview")) return Promise.resolve({
      ok: true,
      headers: new Headers({ "content-type": "image/png", "content-disposition": "inline; filename=\"site-photo.png\"" }),
      blob: async () => new Blob(["png"], { type: "image/png" }),
    });
    if (String(url).endsWith("/annotations") && options.method === "POST") return Promise.resolve(jsonResponse(imageAttachment({ id: "annotation-2", source_type: "annotation_derivative", original_attachment_id: "image-1" })));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function defaultCapabilities(role = "owner") {
  return {
    can_manage_employees: ["owner", "admin", "manager"].includes(role),
    can_review_time: ["owner", "admin", "manager"].includes(role),
    can_manage_pay: role === "owner",
    can_use_employee_portal: true,
    can_manage_announcements: ["owner", "admin"].includes(role),
  };
}

function storedSession(role = "owner", capabilities = defaultCapabilities(role)) {
  return {
    access_token: "token",
    user: { id: `${role}-user`, role },
    tenant,
    capabilities,
  };
}

function mockAuthenticatedApp({ role = "owner", capabilities = defaultCapabilities(role), route = "/orders", calendarPostConflict = false, productionWorkOrders = false, productionSendDeferred = null, announcementItems = [announcement], participantItems = [{ user_id: "user-1", display_name: "Owner User", employee_id: "employee-owner", role: "owner" }], participantsError = false, backupPreview = currentBackupPreview, authMeSessions = null, employeeItems = [employee] } = {}) {
  localStorage.setItem("signguySlimSession", JSON.stringify(storedSession(role, capabilities)));
  window.location.hash = route;
  let calendarConflictReturned = false;
  let authMeIndex = 0;
  const fetch = vi.fn((url, options = {}) => {
    if (url === "/api/auth/me") {
      const response = authMeSessions?.[Math.min(authMeIndex, authMeSessions.length - 1)] || storedSession(role, capabilities);
      authMeIndex += 1;
      return Promise.resolve(jsonResponse(response));
    }
    if (url === "/api/customers") return Promise.resolve(jsonResponse({ items: [customer] }));
    if (url === "/api/settings") return Promise.resolve(jsonResponse({ tenant, users }));
    if (url === "/api/backup/history") return Promise.resolve(jsonResponse({ items: [] }));
    if (url === "/api/backup/preview" && options?.method === "POST") return Promise.resolve(jsonResponse(backupPreview));
    if (url === "/api/employees" && options?.method === "POST") return Promise.resolve(jsonResponse(employeeItems[0] || employee));
    if (url === "/api/employees") return Promise.resolve(jsonResponse({ items: employeeItems }));
    if (String(url).startsWith("/api/employees/") && String(url).endsWith("/rates") && options?.method === "POST") return Promise.resolve(jsonResponse({ items: [{ id: "rate-2", hourly_rate_cents: 2000, effective_date: "2026-08-22" }] }));
    if (String(url).startsWith("/api/employees/") && options?.method === "PATCH") return Promise.resolve(jsonResponse({ ok: true }));
    if (String(url).startsWith("/api/time/entries") && (!options || options.method === "GET" || !options.method)) return Promise.resolve(jsonResponse(timeSummary));
    if (url === "/api/time/entries") return Promise.resolve(jsonResponse(closedTimeEntry));
    if (String(url).startsWith("/api/time/entries/") && options?.method === "PATCH") return Promise.resolve(jsonResponse(closedTimeEntry));
    if (String(url).startsWith("/api/time/entries/") && String(url).endsWith("/void")) return Promise.resolve(jsonResponse({ ...closedTimeEntry, status: "void" }));
    if (url === "/api/payroll/employees") return Promise.resolve(jsonResponse({ items: employeeItems.map(({ id, employee_number, name, active }) => ({ id, employee_number, name, active })) }));
    if (String(url).startsWith("/api/payroll/employees/") && String(url).endsWith("/close")) return Promise.resolve(jsonResponse({ ...payDetail, week: { ...payWeek, status: "closed", closing_carryover_cents: 2350 } }));
    if (String(url).startsWith("/api/payroll/employees/") && String(url).endsWith("/reopen")) return Promise.resolve(jsonResponse(payDetail));
    if (String(url).startsWith("/api/payroll/employees/")) return Promise.resolve(jsonResponse(payDetail));
    if (["/api/payroll/advances", "/api/payroll/adjustments", "/api/payroll/manual-payments"].includes(url)) return Promise.resolve(jsonResponse(payDetail));
    if (url === "/api/employee-portal/time-clock") return Promise.resolve(jsonResponse(timeSummary));
    if (url === "/api/employee-portal/my-pay") return Promise.resolve(jsonResponse(payDetail));
    if (url === "/api/employee-portal/clock-in" || url === "/api/employee-portal/clock-out") return Promise.resolve(jsonResponse({ ...timeSummary, open_entry: url.endsWith("clock-in") ? openTimeEntry : null }));
    if (url === "/api/announcements" && options?.method === "POST") return Promise.resolve(jsonResponse({ ...announcement, id: "announcement-2", unread: false }));
    if (String(url).startsWith("/api/announcements/") && String(url).endsWith("/archive")) return Promise.resolve(jsonResponse({ ...announcement, archived_at: "2026-08-21T13:00:00.000Z" }));
    if (String(url).startsWith("/api/announcements/") && options?.method === "PATCH") return Promise.resolve(jsonResponse({ ...announcement, title: "Updated Shop Meeting", unread: false }));
    if (url === "/api/announcements") return Promise.resolve(jsonResponse({ items: announcementItems }));
    if (url === "/api/employee-portal/announcements") return Promise.resolve(jsonResponse({ employee, items: [announcement] }));
    if (url === "/api/employee-portal/announcements/announcement-1") return Promise.resolve(jsonResponse(readAnnouncement));
    if (url === "/api/employee-portal/message-participants") return participantsError ? Promise.resolve(jsonError(500, { error: "participant_failed" })) : Promise.resolve(jsonResponse({ items: participantItems }));
    if (url === "/api/employee-portal/messages" && options?.method === "POST") {
      const parsed = JSON.parse(options.body || "{}");
      return Promise.resolve(jsonResponse({ id: "message-2", sender_user_id: "user-2", recipient_user_id: parsed.recipient_user_id, body: "On it.", sent_at: "2026-08-21T12:30:00.000Z", direction: "sent" }));
    }
    if (url === "/api/employee-portal/messages") return Promise.resolve(jsonResponse({ items: [conversation] }));
    if (url === "/api/employee-portal/messages/user-1") return Promise.resolve(jsonResponse(messageThread));
    if (url === "/api/employee-portal/messages/user-3") return Promise.resolve(jsonResponse(managerThread));
    if (String(url).startsWith("/api/dashboard")) return Promise.resolve(jsonResponse({
      timezone: "America/New_York",
      production: { stages: ["not_started", "ready", "in_progress", "waiting", "complete"].map((stage) => ({ stage, label: stage.replace(/_/g, " "), count: stage === "not_started" ? 1 : 0, items: stage === "not_started" ? [{ ...workspaceOrder.items[0], order_id: "order-1", order_number: "O-00001", due_date: "2026-08-25" }] : [] })) },
      calendar: { start_date: "2026-08-21", end_date: "2026-09-03", days: ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"].map((date, index) => ({ date, today: index === 0, events: index === 0 ? [calendarEvent] : [] })) },
      attention: [{ source_type: "invoice", source_id: "invoice-1", reason: "payment_attention", title: "I-00001", severity: "payment attention", link: "#/invoices" }],
    }));
    if (url === "/api/orders") return Promise.resolve(jsonResponse({ items: [workspaceOrder] }));
    if (url === "/api/orders/order-1/workspace") return Promise.resolve(jsonResponse({ order: workspaceOrder, customer: customerDetail, users, attachments: [{ id: "attachment-1", original_filename: "proof.txt", mime_type: "text/plain", byte_size: 5, sha256: "abcdef1234567890", previewable: true }] }));
    if (String(url).startsWith("/api/invoices/") && String(url).endsWith("/payment")) return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/invoices") return Promise.resolve(jsonResponse({ items: [
      { id: "invoice-1", invoice_number: "I-00001", order_id: "order-1", order_number: "O-00001", customer_summary: { contact_name: "Avery Customer", business_name: "Avery Signs" }, document_status: "issued", payment_status: "partial", total_cents: 1500, amount_paid_cents: 1000, balance_due_cents: 500 },
      { id: "invoice-2", invoice_number: "I-00002", order_id: "order-2", order_number: "O-00002", customer_summary: { contact_name: "Blake Customer", business_name: "" }, document_status: "issued", payment_status: "paid", total_cents: 2200, amount_paid_cents: 2200, balance_due_cents: 0 },
      { id: "invoice-3", invoice_number: "I-00003", order_id: "order-3", order_number: "O-00003", customer_summary: { contact_name: "Casey Customer", business_name: "Casey Wraps" }, document_status: "draft", payment_status: "unpaid", total_cents: 1800, amount_paid_cents: 0, balance_due_cents: 1800 },
    ] }));
    if (url === "/api/orders/order-1/production/send") {
      const response = jsonResponse({ order: { ...workspaceOrder, sent_to_production_at: "2026-08-21T12:00:00.000Z", work_orders: [workOrder] }, work_orders: [workOrder], already_sent: false });
      return productionSendDeferred || Promise.resolve(response);
    }
    if (url === "/api/orders/order-1/production/regroup") return Promise.resolve(jsonResponse({ order: { ...workspaceOrder, sent_to_production_at: "2026-08-21T12:00:00.000Z", work_orders: [workOrder] }, work_orders: [workOrder] }));
    if (url === "/api/orders/order-1/bundles") return Promise.resolve(jsonResponse({ items: [{ id: "bundle-1", title: "Lobby Package", pricing_mode: "bundle_price", manual_total_cents: 1500, show_member_prices: false, items: [workspaceOrder.items[0]] }] }));
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
    if (url === "/api/production/board" && productionWorkOrders) return Promise.resolve(jsonResponse({ stages: ["not_started", "ready", "in_progress", "waiting", "complete"], users, items: [workOrder] }));
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
    if (url === "/api/production/work-orders/work-order-1") return Promise.resolve(jsonResponse(workOrder));
    if (url === "/api/production/work-orders/work-order-1/stage") return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/production/work-orders/work-order-1/completion") return Promise.resolve(jsonResponse({ ok: true }));
    if (String(url).startsWith("/api/calendar") && (!options || options.method === "GET" || !options.method)) return Promise.resolve(jsonResponse({ items: [calendarEvent, calendarProductionEvent, calendarEmployeeEvent, calendarOverflowEvent, calendarSalesEvent, calendarDeadlineEvent], users, departments: calendarDepartments, resources: calendarResources, views: calendarViews, can_manage_schedule: role !== "staff", timezone: "America/New_York" }));
    if (url === "/api/schedule/views" && (!options || options.method === "GET")) return Promise.resolve(jsonResponse({ items: calendarViews, can_manage_shared: role !== "staff" }));
    if (url === "/api/schedule/departments" && (!options || options.method === "GET")) return Promise.resolve(jsonResponse({ items: calendarDepartments, users }));
    if (url === "/api/schedule/resources" && (!options || options.method === "GET")) return Promise.resolve(jsonResponse({ items: calendarResources, departments: calendarDepartments }));
    if (url === "/api/schedule/views/view-install") return Promise.resolve(jsonResponse(calendarViews[1]));
    if (url === "/api/schedule/views") return Promise.resolve(jsonResponse({ ...calendarViews[1], id: "view-custom", name: "Custom" }));
    if (String(url).startsWith("/api/schedule/views/")) return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/schedule/departments") return Promise.resolve(jsonResponse({ ...calendarDepartments[0], id: "dept-new" }));
    if (String(url).startsWith("/api/schedule/departments/")) return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/schedule/resources") return Promise.resolve(jsonResponse({ ...calendarResources[0], id: "resource-new" }));
    if (String(url).startsWith("/api/schedule/resources/")) return Promise.resolve(jsonResponse({ ok: true }));
    if (url === "/api/calendar" && options?.method === "POST" && calendarPostConflict && (calendarPostConflict !== "once" || !calendarConflictReturned)) {
      calendarConflictReturned = true;
      return Promise.resolve(jsonError(409, {
      error: "schedule_conflict",
      conflicts: [{ type: "resource", resource_id: "resource-1", name: "Bucket Truck", reason: "resource_capacity_exceeded" }],
      }));
    }
    if (url === "/api/calendar") return Promise.resolve(jsonResponse({ ...calendarEvent, id: "calendar-2" }));
    if (url === "/api/calendar/calendar-1") return Promise.resolve(jsonResponse(calendarEvent));
    if (url === "/api/calendar/calendar-1/complete") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "complete" }));
    if (url === "/api/calendar/calendar-1/reopen") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "scheduled" }));
    if (url === "/api/calendar/calendar-1/cancel") return Promise.resolve(jsonResponse({ ...calendarEvent, status: "cancelled" }));
    if (url === "/api/estimates") return Promise.resolve(jsonResponse({ items: [{ id: "estimate-1", estimate_number: "E-00001", status: "draft", total_cents: 1500 }] }));
    if (url === "/api/estimates/estimate-1/bundles") return Promise.resolve(jsonResponse({ items: [] }));
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
        id: "estimate-item-1",
        title: "Installed panel",
        description: "Installed panel",
        quantity_decimal: "1",
        unit_price_cents: 1500,
        taxable: true,
        production_required: false,
        due_date: null,
        assigned_user_id: null,
        internal_note: null,
      }],
      bundles: [],
    }));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function cssRule(selector) {
  return cssRules(selector)[0] || "";
}

function cssRules(selector) {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

describe("Version 2 Stage 1-8 navigation boundary", () => {
  it("renders the approved area sidebar order and Stage 7-8 operational areas", () => {
    expect(enabledNavigationItems().map((item) => item.key)).toEqual([
      "home",
      "shop",
      "team",
      "business",
      "employee-portal",
    ]);
    expect(enabledOperationalAreas().map((item) => item.label)).toEqual(["Shop Operations", "Team & Productivity", "Business Management", "Employee Portal"]);
    expect(enabledOperationalAreas().map((item) => item.href)).toEqual(["#/customers", "#/production", "#/invoices", "#/employee-portal/time-clock"]);
  });

  it("keeps only approved working area modules without later-stage navigation", () => {
    expect(VERSION_1_NAVIGATION.map((item) => item.label)).toEqual([
      "Home",
      "Shop Operations",
      "Team & Productivity",
      "Business Management",
      "Employee Portal",
    ]);
    const labels = JSON.stringify(VERSION_1_NAVIGATION);
    expect(labels).toContain("Incoming Requests");
    ["Employees", "Time & Attendance", "Payroll", "Time Clock", "My Pay", "Announcements", "Messages"].forEach((label) => expect(labels).toContain(label));
    ["Bookkeeping", "Sales Tax", "Stripe", "Facebook", "Meta", "Sales", "Money", "Restricted Portal"].forEach((label) => expect(labels).not.toContain(label));
    expect(VERSION_1_NAVIGATION.find((item) => item.key === "shop").modules.map((item) => item.label)).toEqual(["Customers", "Quotes", "Orders"]);
    expect(VERSION_1_NAVIGATION.find((item) => item.key === "business").modules.map((item) => item.label)).toEqual(["Invoices", "Payments", "Payroll"]);
    expect(VERSION_1_NAVIGATION.find((item) => item.key === "employee-portal").modules.map((item) => item.label)).toEqual(["Time Clock", "My Pay", "Messages", "Announcements"]);
  });

  it("hides capability-gated employee, time, payroll, portal, and announcement modules", () => {
    const staffLabels = JSON.stringify(enabledNavigationItems(undefined, "staff", { ...defaultCapabilities("staff"), can_use_employee_portal: false }));
    const managerLabels = JSON.stringify(filterNavigationForRole(VERSION_1_NAVIGATION, "manager", defaultCapabilities("manager")));
    const managerWithPayLabels = JSON.stringify(filterNavigationForRole(VERSION_1_NAVIGATION, "manager", { ...defaultCapabilities("manager"), can_manage_pay: true }));
    expect(staffLabels).not.toContain("Employees");
    expect(staffLabels).not.toContain("Time & Attendance");
    expect(staffLabels).not.toContain("Payroll");
    expect(staffLabels).not.toContain("Employee Portal");
    expect(staffLabels).not.toContain("\"href\":\"#/announcements\"");
    expect(managerLabels).toContain("Employees");
    expect(managerLabels).toContain("Time & Attendance");
    expect(managerLabels).not.toContain("Payroll");
    expect(managerWithPayLabels).toContain("Payroll");
    expect(managerLabels).not.toContain("\"href\":\"#/announcements\"");
    expect(enabledOperationalAreas(undefined, "staff", defaultCapabilities("staff")).map((item) => item.label)).toEqual(["Shop Operations", "Team & Productivity", "Business Management", "Employee Portal"]);
    expect(enabledOperationalAreas(undefined, "staff", { ...defaultCapabilities("staff"), can_use_employee_portal: false }).map((item) => item.label)).toEqual(["Shop Operations", "Team & Productivity", "Business Management"]);
  });

  it("maps deep links to the correct area, module, and internal tab", () => {
    expect(getRouteContext("/estimates")).toMatchObject({ areaKey: "shop", moduleKey: "quotes" });
    expect(getRouteContext("/orders/incoming")).toMatchObject({ areaKey: "shop", moduleKey: "orders", childKey: "incoming-requests" });
    expect(getRouteContext("/orders/order-1")).toMatchObject({ areaKey: "shop", moduleKey: "orders", childKey: null });
    expect(getRouteContext("/production")).toMatchObject({ areaKey: "team", moduleKey: "work-board" });
    expect(getRouteContext("/calendar")).toMatchObject({ areaKey: "team", moduleKey: "calendar" });
    expect(getRouteContext("/calendar/calendar-1")).toMatchObject({ areaKey: "team", moduleKey: "calendar" });
    expect(getRouteContext("/employees")).toMatchObject({ areaKey: "team", moduleKey: "employees" });
    expect(getRouteContext("/time")).toMatchObject({ areaKey: "team", moduleKey: "time" });
    expect(getRouteContext("/announcements")).toMatchObject({ areaKey: "team", moduleKey: "announcements" });
    expect(getRouteContext("/invoices")).toMatchObject({ areaKey: "business", moduleKey: "invoices", childKey: null });
    expect(getRouteContext("/payments")).toMatchObject({ areaKey: "business", moduleKey: "payments", childKey: null });
    expect(getRouteContext("/payroll")).toMatchObject({ areaKey: "business", moduleKey: "payroll", childKey: null });
    expect(getRouteContext("/employee-portal/my-pay")).toMatchObject({ areaKey: "employee-portal", moduleKey: "my-pay", childKey: null });
    expect(getRouteContext("/employee-portal/announcements")).toMatchObject({ areaKey: "employee-portal", moduleKey: "announcements", childKey: null });
    expect(getRouteContext("/employee-portal/messages")).toMatchObject({ areaKey: "employee-portal", moduleKey: "messages", childKey: null });
    expect(getRouteContext("/backup")).toMatchObject({ areaKey: "settings", moduleKey: "backup" });
  });

  it("renders the area sidebar, module tabs, Quick Access, and compact ribbon without the legacy top nav", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Area navigation" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    expect(document.querySelectorAll("[data-operational-area]")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Shop Operations/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Shop Operations modules" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
    expect(screen.getByRole("link", { name: "Orders" }).getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".topbar")).toBeNull();
    expect(screen.getByLabelText("Quick Access")).toBeTruthy();
    expect(screen.getByLabelText("New Order").getAttribute("href")).toBe("#/orders/new");
    const ribbon = screen.getByLabelText("Orders list ribbon");
    expect(ribbon.classList.contains("office-ribbon")).toBe(true);
    ["Create", "View", "Workflow", "Tools"].forEach((group) => expect(within(ribbon).queryByText(group)).toBeNull());
    expect(within(ribbon).getByRole("link", { name: /New Order/ }).getAttribute("href")).toBe("#/orders/new");
    expect(within(ribbon).queryByRole("link", { name: /Production/ })).toBeNull();
    expect(within(ribbon).queryByRole("link", { name: /Calendar/ })).toBeNull();
    expect(screen.queryByLabelText("Search orders")).toBeNull();
    fireEvent.click(within(ribbon).getByRole("button", { name: /Search/ }));
    expect(screen.getByLabelText("Search orders")).toBeTruthy();

    window.location.hash = "#/production";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByLabelText("Production ribbon")).toBeTruthy();
    expect(screen.queryByLabelText("Orders list ribbon")).toBeNull();
  });

  it("uses Incoming Requests as the canonical Orders subview while preserving the old intake redirect", async () => {
    mockAuthenticatedApp({ route: "/orders/intake" });
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#/orders/incoming"));
    expect(await screen.findByLabelText("Incoming Requests ribbon")).toBeTruthy();
    expect(screen.getAllByText("Incoming Requests").length).toBeGreaterThan(1);
    expect(screen.getByPlaceholderText("Search requests")).toBeTruthy();
  });

  it("keeps reserved Orders subpaths out of Order Workspace ID parsing", async () => {
    const fetch = mockAuthenticatedApp({ route: "/orders/incoming" });
    render(<App />);

    expect(await screen.findByLabelText("Incoming Requests ribbon")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalledWith("/api/orders/incoming/workspace", expect.anything());

    cleanup();
    const fetchNew = mockAuthenticatedApp({ route: "/orders/new" });
    render(<App />);
    expect(await screen.findByLabelText("New Order")).toBeTruthy();
    expect(fetchNew).not.toHaveBeenCalledWith("/api/orders/new/workspace", expect.anything());

    cleanup();
    const fetchExisting = mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);
    await screen.findByLabelText("Order Workspace O-00001");
    expect(fetchExisting).toHaveBeenCalledWith("/api/orders/order-1/workspace", expect.anything());
  });

  it("renders Payments as a distinct page and safely records cumulative paid amounts", async () => {
    const fetch = mockAuthenticatedApp({ route: "/payments" });
    render(<App />);

    expect(await screen.findByLabelText("Payments ribbon")).toBeTruthy();
    expect(screen.getByLabelText("Payment status filter")).toBeTruthy();
    expect(screen.getByText(/Total amount paid is cumulative paid-to-date/)).toBeTruthy();
    expect(screen.getAllByText("Record Payment")).toHaveLength(2);
    expect(screen.getByText("Avery Signs / O-00001")).toBeTruthy();
    expect(screen.getByText("Balance $5.00")).toBeTruthy();
    expect(screen.getByText("Total $15.00")).toBeTruthy();
    expect(screen.getByText("Paid $10.00")).toBeTruthy();
    expect(screen.getByText("Payment partial")).toBeTruthy();
    expect(screen.queryByText("I-00002")).toBeNull();
    expect(screen.getByText("I-00003")).toBeTruthy();

    const partialRow = screen.getByText("I-00001").closest("article");
    const partialInput = within(partialRow).getByLabelText("Total amount paid for I-00001");
    expect(partialInput.value).toBe("10.00");
    fireEvent.change(partialInput, { target: { value: "" } });
    expect(within(partialRow).getByRole("button", { name: "Record Payment" }).disabled).toBe(true);
    fireEvent.change(partialInput, { target: { value: "0" } });
    expect(within(partialRow).getByRole("button", { name: "Record Payment" }).disabled).toBe(true);
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/invoices/invoice-1/payment" && options?.method === "POST")).toBe(false);

    fireEvent.change(partialInput, { target: { value: "12.00" } });
    fireEvent.click(within(partialRow).getByRole("button", { name: "Record Payment" }));
    await waitFor(() => {
      const post = fetch.mock.calls.find(([url, options]) => url === "/api/invoices/invoice-1/payment" && options?.method === "POST");
      expect(JSON.parse(post[1].body).amount_paid_cents).toBe(1200);
    });

    const unpaidRow = screen.getByText("I-00003").closest("article");
    expect(within(unpaidRow).getByLabelText("Total amount paid for I-00003").value).toBe("0.00");
    fireEvent.click(within(unpaidRow).getByRole("button", { name: "Record Payment" }));
    await waitFor(() => {
      const post = fetch.mock.calls.find(([url, options]) => url === "/api/invoices/invoice-3/payment" && options?.method === "POST");
      expect(JSON.parse(post[1].body).amount_paid_cents).toBe(0);
    });

    fireEvent.change(screen.getByLabelText("Payment status filter"), { target: { value: "paid" } });
    expect(screen.getByText("I-00002")).toBeTruthy();
    expect(screen.getByText("Paid $22.00")).toBeTruthy();
    expect(screen.getByText("Balance $0.00")).toBeTruthy();
    expect(screen.queryByText("I-00001")).toBeNull();
    const paidRow = screen.getByText("I-00002").closest("article");
    const paidInput = within(paidRow).getByLabelText("Total amount paid for I-00002");
    expect(paidInput.value).toBe("22.00");
    fireEvent.change(paidInput, { target: { value: "" } });
    expect(within(paidRow).getByRole("button", { name: "Record Payment" }).disabled).toBe(true);
    fireEvent.change(paidInput, { target: { value: "0" } });
    expect(within(paidRow).getByRole("button", { name: "Record Payment" }).disabled).toBe(true);
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/invoices/invoice-2/payment" && options?.method === "POST")).toBe(false);
    expect(screen.queryByText("Create From Order")).toBeNull();
  });

  it("removes stale pricing and tasks route aliases from page rendering", async () => {
    mockAuthenticatedApp({ route: "/pricing" });
    render(<App />);

    expect((await screen.findAllByText("Page Not Available")).length).toBeGreaterThan(1);
    expect(screen.queryByLabelText("Company name")).toBeNull();

    window.location.hash = "#/tasks";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Page Not Available")).length).toBeGreaterThan(1);
    expect(screen.queryByLabelText("Production ribbon")).toBeNull();
  });

  it("renders Backup & Restore directly for the backup deep link", async () => {
    mockAuthenticatedApp({ route: "/backup" });
    render(<App />);

    expect(await screen.findByText(/Backups include supported Slim shop, scheduling, employee, message, announcement, audit, and attachment records/)).toBeTruthy();
    expect(screen.queryByText("Company Settings")).toBeNull();
  });

  it("opens the mobile drawer and restores focus to the menu button on Escape", async () => {
    mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    const opener = await screen.findByRole("button", { name: "Open navigation menu" });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog", { name: "Navigation menu" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation menu" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("applies capability filtering inside the mobile navigation drawer", async () => {
    mockAuthenticatedApp({ role: "manager", capabilities: { ...defaultCapabilities("manager"), can_manage_pay: false, can_use_employee_portal: false }, route: "/calendar" });
    render(<App />);

    const opener = await screen.findByRole("button", { name: "Open navigation menu" });
    fireEvent.click(opener);
    const drawer = await screen.findByRole("dialog", { name: "Navigation menu" });
    expect(within(drawer).getByRole("link", { name: "Team & Productivity" })).toBeTruthy();
    expect(within(drawer).queryByRole("link", { name: "Payroll" })).toBeNull();
    expect(within(drawer).queryByRole("link", { name: "Employee Portal" })).toBeNull();
  });

  it("refreshes session capabilities after creating a current-user Employee portal record", async () => {
    const noPortal = { ...defaultCapabilities("owner"), can_use_employee_portal: false };
    const withPortal = { ...defaultCapabilities("owner"), can_use_employee_portal: true };
    const fetch = mockAuthenticatedApp({
      route: "/employees",
      capabilities: noPortal,
      authMeSessions: [storedSession("owner", noPortal), storedSession("owner", withPortal)],
    });
    render(<App />);

    expect(await screen.findByText("Employee Administration")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Employee Portal" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Employee" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Employee Portal" })).toBeTruthy());
    expect(fetch.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(2);
  });

  it("refreshes session capabilities after disabling current-user Employee portal access", async () => {
    const withPortal = { ...defaultCapabilities("owner"), can_use_employee_portal: true };
    const noPortal = { ...defaultCapabilities("owner"), can_use_employee_portal: false };
    const ownerEmployee = { ...employee, id: "employee-owner", user_id: "user-1", name: "Owner User", email: "owner@example.com", portal_access_enabled: true };
    const fetch = mockAuthenticatedApp({
      route: "/employees",
      capabilities: withPortal,
      employeeItems: [ownerEmployee],
      authMeSessions: [storedSession("owner", withPortal), storedSession("owner", noPortal)],
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Employee Portal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disable Portal" }));

    await waitFor(() => expect(screen.queryByRole("link", { name: "Employee Portal" })).toBeNull());
    expect(fetch.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(2);
  });

  it("refreshes session capabilities after current-user pay access changes", async () => {
    const noPay = { ...defaultCapabilities("owner"), can_manage_pay: false };
    const withPay = { ...defaultCapabilities("owner"), can_manage_pay: true };
    const ownerEmployee = { ...employee, id: "employee-owner", user_id: "user-1", name: "Owner User", email: "owner@example.com", pay_management_enabled: false };
    const fetch = mockAuthenticatedApp({
      route: "/employees",
      capabilities: noPay,
      employeeItems: [ownerEmployee],
      authMeSessions: [storedSession("owner", noPay), storedSession("owner", withPay)],
    });
    render(<App />);

    expect(await screen.findByText("Employee Administration")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Payroll" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grant Pay Access" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Payroll" })).toBeTruthy());
    expect(fetch.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(2);
  });
});

describe("Part 2 UI", () => {
  it("keeps Quick Entry description focus and value while typing", async () => {
    mockAuthenticatedApp({ route: "/orders/new" });
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

  it("preserves Order Item table identity through add, duplicate, reorder, edit, and remove", async () => {
    mockAuthenticatedApp({ route: "/orders/new" });
    render(<App />);

    const firstDescription = await screen.findByLabelText("Description");
    fireEvent.change(firstDescription, { target: { value: "Banner" } });
    fireEvent.click(within(screen.getByLabelText("New order ribbon")).getByRole("button", { name: /^Add Item$/ }));
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

  it("enables the Quote customer selector for creation and disables it for editing", async () => {
    mockAuthenticatedApp({ route: "/estimates" });
    render(<App />);

    expect((await screen.findByLabelText("Customer")).disabled).toBe(false);
    fireEvent.click(await screen.findByText("Edit"));

    expect(await screen.findByText("Quote customer is locked after creation.")).toBeTruthy();
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

  it("groups current Stage 8 backup preview counts across supported domains", async () => {
    const fetch = mockAuthenticatedApp({ route: "/backup" });
    render(<App />);

    expect(await screen.findByText(/Backups include supported Slim shop, scheduling, employee, message, announcement, audit, and attachment records/)).toBeTruthy();
    expect(screen.queryByText(/Slim V1 operational records/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Backup file"), {
      target: { files: [new File(["backup"], "current.signguy-backup", { type: "application/vnd.signguy.backup" })] },
    });
    fireEvent.change(screen.getAllByLabelText("Backup passphrase")[1], { target: { value: "long-passphrase-current" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate Backup" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/backup/preview", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Shop Records")).toBeTruthy();
    expect(screen.getByText("System & Tenant")).toBeTruthy();
    expect(screen.getByText("Production & Scheduling")).toBeTruthy();
    expect(screen.getByText("Employees, Time & Pay")).toBeTruthy();
    expect(screen.getByText("Messages & Announcements")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("Customers: 1")).toBeTruthy();
    expect(screen.getByText("Quote items: 2")).toBeTruthy();
    expect(screen.getByText("Work Orders: 1")).toBeTruthy();
    expect(screen.getByText("Work Order items: 1")).toBeTruthy();
    expect(screen.getByText("Calendar events: 1")).toBeTruthy();
    expect(screen.getByText("Employees: 1")).toBeTruthy();
    expect(screen.getByText("Time entries: 2")).toBeTruthy();
    expect(screen.getByText("Employee announcements: 0")).toBeTruthy();
    expect(screen.getByText("Announcement read states: 0")).toBeTruthy();
    expect(screen.getByText("Employee direct messages: 0")).toBeTruthy();
    expect(screen.getByText("Order attachments: 1")).toBeTruthy();
    expect(screen.getByText("Source: SIGNGUY-SLIM / 0.2.0-v2-stage8")).toBeTruthy();
  });

  it("handles compatible Stage 5-6 backup previews without Stage 7-8 count keys", async () => {
    const legacyPreview = {
      ...currentBackupPreview,
      backup_id: "sgp_v1_backup_stage6",
      source_application_version: "0.2.0-v2-stage6",
      source_schema_version: "012_v2_stage5_6_time_pay.sql",
      counts: {
        tenants: 1,
        users: 2,
        customers: 1,
        estimates: 1,
        estimate_items: 2,
        orders: 1,
        order_items: 2,
        invoices: 1,
        calendar_events: 1,
        employees: 1,
        employee_rates: 1,
        employee_time_entries: 2,
        employee_pay_weeks: 1,
        employee_pay_advances: 1,
        employee_pay_adjustments: 1,
        employee_pay_manual_payments: 1,
        tenant_sequences: 5,
        reminders: 0,
        notes: 0,
        audit_events: 8,
        attachments: 1,
      },
    };
    mockAuthenticatedApp({ route: "/backup", backupPreview: legacyPreview });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Backup file"), {
      target: { files: [new File(["backup"], "stage6.signguy-backup", { type: "application/vnd.signguy.backup" })] },
    });
    fireEvent.change(screen.getAllByLabelText("Backup passphrase")[1], { target: { value: "long-passphrase-legacy" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate Backup" }));

    expect(await screen.findByText("Schema: 012_v2_stage5_6_time_pay.sql")).toBeTruthy();
    expect(screen.getByText("Source: SIGNGUY-SLIM / 0.2.0-v2-stage6")).toBeTruthy();
    expect(screen.getByText("Employees, Time & Pay")).toBeTruthy();
    expect(screen.getByText("Pay weeks: 1")).toBeTruthy();
    expect(screen.queryByText("Employee announcements: 0")).toBeNull();
    expect(screen.queryByText("Announcement read states: 0")).toBeNull();
    expect(screen.queryByText("Employee direct messages: 0")).toBeNull();
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

    expect(await screen.findByLabelText(/Order Workspace O-00001/)).toBeTruthy();
    expect(screen.getAllByText("O-00001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Avery Signs").length).toBeGreaterThan(0);
    expect(screen.getByText("avery@example.com").closest("a").getAttribute("href")).toBe("mailto:avery@example.com");
    expect(screen.getByText("555-0188").closest("a").getAttribute("href")).toBe("tel:555-0188");
  });

  it("opens the Order Workspace from a deep link and confirms unsaved close", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByLabelText(/Order Workspace O-00001/)).toBeTruthy();
    const notes = screen.getAllByLabelText("Internal notes");
    fireEvent.change(notes.at(-1), { target: { value: "Needs proof" } });
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved Order Workspace changes?");
    expect(screen.getByRole("dialog", { name: /Order Workspace O-00001/ })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/Order changed elsewhere/)).toBeTruthy();
    expect(screen.getByText("Reload")).toBeTruthy();
  });

  it("moves Work Orders with non-drag controls and marks Done/Reopen without showing prices", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production", productionWorkOrders: true });
    render(<App />);

    expect(await screen.findByText("Avery Lobby Sign")).toBeTruthy();
    expect(screen.queryByText("$15.00")).toBeNull();
    fireEvent.change(screen.getByLabelText("Move Avery Lobby Sign to stage"), { target: { value: "ready" } });
    fireEvent.click(await screen.findByText("Done"));

    expect(fetch).toHaveBeenCalledWith("/api/production/work-orders/work-order-1/stage", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("/api/production/work-orders/work-order-1/completion", expect.objectContaining({ method: "POST" }));
  });

  it("moves Work Orders with native drag and drop", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production", productionWorkOrders: true });
    render(<App />);

    const card = (await screen.findByText("Avery Lobby Sign")).closest("article");
    const readyColumn = screen.getAllByText("Ready").find((node) => node.tagName === "H3").closest("section");
    const dataTransfer = {
      value: "",
      setData(_type, value) { this.value = value; },
      getData() { return this.value; },
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(readyColumn, { dataTransfer });

    expect(fetch).toHaveBeenCalledWith("/api/production/work-orders/work-order-1/stage", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ stage: "ready" }),
    }));
  });

  it("keeps unreleased production items visible but read-only on the board", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    expect(await screen.findByText("Installed panel")).toBeTruthy();
    expect(screen.getByText("Unreleased Order Item")).toBeTruthy();
    expect(screen.getByText("Release first")).toBeTruthy();
    expect(screen.getByLabelText("Move Installed panel to stage").disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalledWith("/api/production/items/item-1/stage", expect.anything());
  });

  it("shows Order and Order Item titles plus Production Setup choices in the workspace", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByLabelText(/Order Workspace O-00001/)).toBeTruthy();
    expect(screen.getByLabelText("Order title").value).toBe("Avery Lobby Sign");
    expect(screen.getAllByLabelText("Item title").at(-1).value).toBe("Installed panel");
    expect(screen.getByText("How should this Order move through production?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep the entire Order together" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Track every Order Item separately" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create custom production groups" })).toBeTruthy();
  });

  it("blocks custom production send until every production item is assigned", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByLabelText(/Order Workspace O-00001/);
    fireEvent.click(screen.getByRole("button", { name: "Create custom production groups" }));
    expect(screen.getByText(/still need assignment/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to Production" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Production group for Installed panel"), { target: { value: "independent" } });
    expect(screen.getByRole("button", { name: "Send to Production" }).disabled).toBe(false);
  });

  it("prevents double-click Send to Production submissions while the request is in flight", async () => {
    let resolveSend;
    const delayedSend = new Promise((resolve) => {
      resolveSend = resolve;
    });
    const fetch = mockAuthenticatedApp({ route: "/orders/order-1", productionSendDeferred: delayedSend });
    render(<App />);

    await screen.findByLabelText(/Order Workspace O-00001/);
    const send = screen.getByRole("button", { name: "Send to Production" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === "/api/orders/order-1/production/send")).toHaveLength(1));
    resolveSend(jsonResponse({ order: { ...workspaceOrder, sent_to_production_at: "2026-08-21T12:00:00.000Z", work_orders: [workOrder] }, work_orders: [workOrder], already_sent: false }));
    expect(await screen.findByText("Sent to production")).toBeTruthy();
  });

  it("uses Work Order cards for production summary and scheduling without prices", async () => {
    const fetch = mockAuthenticatedApp({ route: "/production", productionWorkOrders: true });
    render(<App />);

    expect(await screen.findByText("Avery Lobby Sign")).toBeTruthy();
    expect(screen.getByText("1 included item")).toBeTruthy();
    expect(screen.queryByText("$15.00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    expect(await screen.findByRole("dialog", { name: "Work Order Summary" })).toBeTruthy();
    expect(screen.getByText("Installed panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Schedule Work/ }));
    const modal = await screen.findByRole("dialog", { name: "Schedule from Order Workspace" });
    expect(within(modal).getByLabelText("Title").value).toBe("Avery Lobby Sign");
    fireEvent.click(within(modal).getByRole("button", { name: /Create Event/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"work_order_id":"work-order-1"'),
    })));
  });

  it("renders bundle controls for saved Orders and requires override reason for bundle pricing", async () => {
    const fetch = mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByLabelText(/Order Workspace O-00001/);
    fireEvent.click(screen.getByRole("button", { name: /Bundle$/ }));
    fireEvent.change(screen.getByLabelText("Bundle title"), { target: { value: "Lobby Package" } });
    fireEvent.change(screen.getByLabelText("Pricing mode"), { target: { value: "bundle_price" } });
    expect(screen.getByLabelText("Override reason")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Bundle total"), { target: { value: "15.00" } });
    fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "Package price approved" } });
    fireEvent.click(screen.getByLabelText("Installed panel"));
    fireEvent.click(screen.getByRole("button", { name: /Update Bundles/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/bundles", expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"override_reason":"Package price approved"'),
    })));
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
    pinCalendarTestDate();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Calendar", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Team & Productivity/ }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("navigation", { name: "Team & Productivity modules" })).getByRole("link", { name: "Calendar" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(document.querySelector(".shop-schedule")).toBeTruthy();
    expect(document.querySelector(".month-weekday-row")).toBeTruthy();
    expect(document.querySelector(".month-week-grid")).toBeTruthy();
    expect(document.querySelectorAll(".month-weekday")).toHaveLength(7);
    expect([...document.querySelectorAll(".month-weekday")].map((node) => node.textContent)).toEqual(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
    expect(document.querySelector(".month-weekday-row").parentElement).toBe(screen.getByLabelText("Month schedule"));
    expect(cssRule(".month-weekday-row")).toContain("height: 40px");
    expect(cssRules(".month-week-grid").some((rule) => rule.includes("repeat(var(--week-count, 5), minmax(120px, 1fr))"))).toBe(true);
    expect(document.querySelectorAll(".month-cell")).toHaveLength(42);
    const monthSchedule = document.querySelector(".month-schedule");
    expect(monthSchedule.style.getPropertyValue("--week-count")).toBe("6");
    expect(monthSchedule.classList.contains("compact-six-row-month")).toBe(true);
    expect(cssRule(".month-schedule")).toContain("calc(100vh - 310px)");
    expect(cssRule(".month-schedule")).toContain("145px");
    expect(cssRule(".month-schedule")).not.toContain("170px");
    expect(cssRule(".month-week-grid")).not.toContain("105px");
    expect(document.querySelector('[data-date="2026-08-01"]')).toBeTruthy();
    expect(document.querySelector('[data-date="2026-08-30"]')).toBeTruthy();
    expect(document.querySelector('[data-date="2026-08-31"]')).toBeTruthy();
    expect(document.querySelector('[data-date="2026-07-26"]').classList.contains("outside-month")).toBe(true);
    expect(document.querySelector('[data-date="2026-09-05"]').classList.contains("outside-month")).toBe(true);
    expect(screen.queryByText("No scheduled events")).toBeNull();
    expect(screen.getByText("Install appointment")).toBeTruthy();
    expect(screen.getByText("Production Run")).toBeTruthy();
    expect(screen.getByText("Employee Shift")).toBeTruthy();
    expect(screen.getByText("Sales Meeting")).toBeTruthy();
    expect(screen.getByText("Order deadline")).toBeTruthy();
    expect(screen.getByText("+ 1 more")).toBeTruthy();
    expect(screen.getByText("9-10 AM")).toBeTruthy();
    expect(screen.getByText("10-11 AM")).toBeTruthy();
    expect(screen.queryByText("09:00 AM-10:00 AM")).toBeNull();
    expect(document.querySelector('[data-date="2026-08-21"] .month-entry-stack').dataset.hiddenCount).toBe("1");
    expect(cssRule(".month-entry-stack.has-overflow")).toContain("grid-template-rows: 48px 24px");
    expect(cssRule(".month-entry-stack .schedule-entry")).toContain("height: 48px");
    expect(cssRule(".month-cell")).toContain("overflow: hidden");
    expect(cssRule(".month-entry-stack .more-button")).toContain("height: 24px");
    expect(screen.getByText("Install appointment").closest(".schedule-entry").classList.contains("cat-install")).toBe(true);
    expect(screen.getByText("Production Run").closest(".schedule-entry").classList.contains("cat-production")).toBe(true);
    expect(screen.getByText("Employee Shift").closest(".schedule-entry").classList.contains("cat-employee")).toBe(true);
    expect(screen.getByText("Sales Meeting").closest(".schedule-entry").classList.contains("cat-sales")).toBe(true);
    expect(screen.getByText("Order deadline").closest(".schedule-entry").classList.contains("cat-deadline")).toBe(true);
    expect(screen.getByText("Sales Meeting").closest(".schedule-entry").querySelector(".entry-badge").textContent).toBe("Appointment");
    expect(screen.getByText("Sales Meeting").closest(".schedule-entry").getAttribute("title")).toContain("Sales Meeting");
    expect(cssRule(".entry-badge")).toContain("flex: 0 0 auto");
    expect(cssRule(".entry-time")).toContain("text-overflow: ellipsis");
    expect(cssRule(".month-entry-stack .entry-title")).toContain("text-overflow: ellipsis");
    expect(cssRule(".cat-production")).toContain("--entry-color: #7B3DA6");
    expect(cssRule(".cat-install")).toContain("--entry-color: #3F7FC4");
    expect(cssRule(".cat-employee")).toContain("--entry-color: #229C9F");
    expect(cssRule(".cat-sales")).toContain("--entry-color: #E06F00");
    expect(cssRule(".cat-deadline")).toContain("--entry-color: #C93F3F");
    const ribbon = await screen.findByLabelText("Calendar ribbon");
    expect([...ribbon.children].map((child) => child.textContent).filter(Boolean)).toEqual(["Event", "Task", "Appointment", "Today", "Month", "Week", "Day", "Agenda", "Filters"]);
    ["Create", "View", "Tools"].forEach((caption) => expect(within(ribbon).queryByText(caption)).toBeNull());
    fireEvent.click(within(ribbon).getByRole("button", { name: /Week/ }));
    fireEvent.click(within(ribbon).getByRole("button", { name: /Day/ }));
    fireEvent.click(within(ribbon).getByRole("button", { name: /Agenda/ }));
    fireEvent.click(within(ribbon).getByRole("button", { name: /Filters/ }));
    const filters = await screen.findByRole("dialog", { name: "Calendar Filters" });
    fireEvent.change(within(filters).getByLabelText("Employee"), { target: { value: "user-2" } });
    fireEvent.change(within(filters).getByLabelText("Status"), { target: { value: "scheduled" } });
    fireEvent.change(within(filters).getByLabelText("Linked records"), { target: { value: "order_item" } });
    fireEvent.click(within(filters).getByRole("button", { name: /Apply/ }));
    fireEvent.click(await screen.findByText("Install appointment"));
    const detail = await screen.findByRole("dialog", { name: /Edit Event/ });
    fireEvent.click(within(detail).getByRole("button", { name: /Complete/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar/calendar-1/complete", expect.objectContaining({ method: "POST" })));
  });

  it("renders five-week months without imposing a universal five-row or six-row grid", async () => {
    pinCalendarTestDate();
    mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Calendar", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "August 2026" })).toBeTruthy();
    expect(document.querySelectorAll(".month-cell")).toHaveLength(42);
    expect(document.querySelector(".month-schedule").style.getPropertyValue("--week-count")).toBe("6");

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));

    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeTruthy();
    expect(document.querySelectorAll(".month-cell")).toHaveLength(35);
    expect(document.querySelector(".month-schedule").style.getPropertyValue("--week-count")).toBe("5");
    expect(document.querySelector('[data-date="2026-08-30"]').classList.contains("outside-month")).toBe(true);
    expect(document.querySelector('[data-date="2026-10-03"]').classList.contains("outside-month")).toBe(true);
  });

  it("creates and reschedules Calendar events from accessible overlays", async () => {
    pinCalendarTestDate();
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    const ribbon = await screen.findByLabelText("Calendar ribbon");
    fireEvent.click(within(ribbon).getByRole("button", { name: /^Event$/ }));
    const create = await screen.findByRole("dialog", { name: "Create Event" });
    fireEvent.change(within(create).getByLabelText("Title"), { target: { value: "New survey" } });
    fireEvent.change(within(create).getByLabelText("Start"), { target: { value: "2026-08-22T09:00" } });
    fireEvent.change(within(create).getByLabelText("End"), { target: { value: "2026-08-22T10:00" } });
    fireEvent.click(within(create).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar", expect.objectContaining({ method: "POST" })));

    fireEvent.click(await screen.findByText("Install appointment"));
    const edit = await screen.findByRole("dialog", { name: "Edit Event" });
    fireEvent.change(within(edit).getByLabelText("Start"), { target: { value: "2026-08-23T09:00" } });
    fireEvent.click(within(edit).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calendar/calendar-1", expect.objectContaining({ method: "PATCH" })));
  });

  it("uses shared Calendar View and My Schedule without duplicating entries", async () => {
    pinCalendarTestDate();
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    const rail = await screen.findByLabelText("Calendars");
    ["All Shop Schedules", "Production", "Install Schedule", "Employee Schedule", "Sales & Appointments", "New Calendar", "My Schedule"].forEach((label) => {
      expect(within(rail).getByText(label)).toBeTruthy();
    });
    fireEvent.click(within(rail).getByRole("button", { name: "Install Schedule" }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("view_id=view-install"))).toBe(true));
    expect(screen.getAllByText("Install appointment")).toHaveLength(1);
    fireEvent.click(within(rail).getByRole("button", { name: "My Schedule" }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("my_schedule=1"))).toBe(true));
  });

  it("allows managers to manage schedule views, departments, resources, and entry assignments", async () => {
    const fetch = mockAuthenticatedApp({ route: "/calendar" });
    render(<App />);

    const rail = await screen.findByLabelText("Calendars");
    fireEvent.click(within(rail).getByRole("button", { name: "New Calendar" }));
    const manage = await screen.findByRole("dialog", { name: "Manage Calendars/View Settings" });
    fireEvent.change(within(manage).getByLabelText("Shared view name"), { target: { value: "Install North" } });
    fireEvent.click(within(manage).getByRole("button", { name: /Create shared view/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/schedule/views", expect.objectContaining({ method: "POST" })));
    fireEvent.change(within(manage).getByLabelText("Department name"), { target: { value: "Permits" } });
    fireEvent.change(within(manage).getByLabelText("Department employee"), { target: { value: "user-2" } });
    fireEvent.click(within(manage).getByRole("button", { name: /Create department/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/schedule/departments", expect.objectContaining({ method: "POST" })));
    fireEvent.change(within(manage).getByLabelText("Resource name"), { target: { value: "Wrap Bay" } });
    fireEvent.click(within(manage).getByRole("button", { name: /Create resource/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/schedule/resources", expect.objectContaining({ method: "POST" })));
    fireEvent.click(within(manage).getByRole("button", { name: "Close" }));

    const ribbon = await screen.findByLabelText("Calendar ribbon");
    fireEvent.click(within(ribbon).getByRole("button", { name: /^Event$/ }));
    const create = await screen.findByRole("dialog", { name: "Create Event" });
    expect(within(create).getByLabelText("Schedule category")).toBeTruthy();
    expect(within(create).getByLabelText("Responsible department")).toBeTruthy();
    expect(within(create).getByText("Additional assignees")).toBeTruthy();
    expect(within(create).getByText("Reserved resources")).toBeTruthy();
    fireEvent.change(within(create).getByLabelText("Title"), { target: { value: "Shared install" } });
    fireEvent.change(within(create).getByLabelText("Responsible department"), { target: { value: "dept-install" } });
    fireEvent.click(within(create).getByLabelText("Bucket Truck"));
    fireEvent.click(within(create).getByLabelText("Staff User"));
    fireEvent.click(within(create).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => {
      const post = fetch.mock.calls.find(([url, options]) => url === "/api/calendar" && options?.method === "POST");
      expect(JSON.parse(post[1].body)).toMatchObject({ department_id: "dept-install", resource_reservations: [{ resource_id: "resource-1", quantity: 1 }] });
    });
  });

  it("uses structured conflict responses for manager override reasons", async () => {
    const fetch = mockAuthenticatedApp({ route: "/calendar", calendarPostConflict: "once" });
    render(<App />);

    const ribbon = await screen.findByLabelText("Calendar ribbon");
    fireEvent.click(within(ribbon).getByRole("button", { name: /^Event$/ }));
    const create = await screen.findByRole("dialog", { name: "Create Event" });
    fireEvent.change(within(create).getByLabelText("Title"), { target: { value: "Conflicting install" } });
    fireEvent.click(within(create).getByLabelText("Bucket Truck"));
    fireEvent.click(within(create).getByRole("button", { name: /^Save$/ }));

    expect(await within(create).findByText("Schedule conflicts")).toBeTruthy();
    fireEvent.click(within(create).getByLabelText("Override protected conflict"));
    fireEvent.change(within(create).getByLabelText("Override reason"), { target: { value: "Manager approved overlap" } });
    fireEvent.click(within(create).getByRole("button", { name: /^Save$/ }));

    await waitFor(() => {
      const posts = fetch.mock.calls.filter(([url, options]) => url === "/api/calendar" && options?.method === "POST");
      expect(posts).toHaveLength(2);
      expect(JSON.parse(posts[1][1].body)).toMatchObject({ conflict_override: true, conflict_override_reason: "Manager approved overlap" });
    });
  });

  it("does not show staff conflict override controls or calendar financial values", async () => {
    mockAuthenticatedApp({ role: "staff", route: "/calendar", calendarPostConflict: true });
    render(<App />);

    const ribbon = await screen.findByLabelText("Calendar ribbon");
    expect(screen.queryByText("$15.00")).toBeNull();
    expect(screen.queryByText("Payment")).toBeNull();
    fireEvent.click(within(ribbon).getByRole("button", { name: /^Event$/ }));
    const create = await screen.findByRole("dialog", { name: "Create Event" });
    fireEvent.change(within(create).getByLabelText("Title"), { target: { value: "Staff conflict" } });
    fireEvent.click(within(create).getByLabelText("Bucket Truck"));
    fireEvent.click(within(create).getByRole("button", { name: /^Save$/ }));

    expect(await within(create).findByText("Schedule conflicts")).toBeTruthy();
    expect(within(create).queryByLabelText("Override protected conflict")).toBeNull();
    expect(within(create).getByText("Owner, admin, or manager access is required to override protected conflicts.")).toBeTruthy();
  });

  it("hides shared-view management from regular staff", async () => {
    mockAuthenticatedApp({ role: "staff", route: "/calendar" });
    render(<App />);

    const rail = await screen.findByLabelText("Calendars");
    expect(within(rail).getByRole("button", { name: "New Calendar" }).disabled).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Manage Calendars/View Settings" })).toBeNull();
  });

  it("schedules from the Order Workspace without discarding dirty fields", async () => {
    const fetch = mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Info");
    const workspace = screen.getByLabelText(/Order Workspace O-00001/);
    const notes = within(workspace).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Unsaved workspace note" } });
    fireEvent.click(within(screen.getByLabelText("Order workspace ribbon")).getByRole("button", { name: /^Schedule$/ }));
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

    await screen.findByText("Order Info");
    const workspace = screen.getByLabelText(/Order Workspace O-00001/);
    const notes = within(workspace).getByLabelText("Internal notes");
    const description = within(workspace).getByLabelText("Description");
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

  it("captures a device photo without microphone access, supports retake, and uploads only after confirmation", async () => {
    mockCanvas({ blobText: "camera-photo" });
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const enumerateDevices = vi.fn(() => Promise.resolve([
      { kind: "videoinput", deviceId: "rear", label: "Rear Camera" },
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    ]));
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices } });
    const createObjectURL = vi.fn(() => "blob:camera");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const fetch = mockImageWorkspaceFetch();
    render(<App />);

    await screen.findByText("Artwork & Files");
    expect(screen.getByLabelText("Upload attachment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Capture Photo/ }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false })));
    fireEvent.click(screen.getByRole("button", { name: /^Capture$/ }));
    expect(stop).toHaveBeenCalled();
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/orders/order-1/attachments" && options?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Retake/ }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /^Capture$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Use Photo/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments", expect.objectContaining({ method: "POST" })));
    const uploadCall = fetch.mock.calls.find(([url, options]) => url === "/api/orders/order-1/attachments" && options?.method === "POST");
    expect(uploadCall[1].body.get("source_type")).toBe("device_capture");
    expect(uploadCall[1].body.get("file").type).toBe("image/jpeg");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:camera");
  });

  it("keeps upload available when camera is unsupported or permission is denied and stops tracks on cancel", async () => {
    mockCanvas();
    const fetch = mockImageWorkspaceFetch();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<App />);

    await screen.findByText("Artwork & Files");
    fireEvent.click(screen.getByRole("button", { name: /Capture Photo/ }));
    expect(await screen.findByText(/not supported/)).toBeTruthy();
    expect(screen.getByLabelText("Upload attachment")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1));
    expect(fetch.mock.calls.some(([url, options]) => url === "/api/orders/order-1/attachments" && options?.method === "POST")).toBe(false);

    cleanup();
    const stop = vi.fn();
    const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn(() => Promise.resolve([])) } });
    mockImageWorkspaceFetch();
    render(<App />);
    await screen.findByText("Artwork & Files");
    fireEvent.click(screen.getByRole("button", { name: /Capture Photo/ }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1));
    expect(stop).toHaveBeenCalled();

    cleanup();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }))), enumerateDevices: vi.fn() } });
    mockImageWorkspaceFetch();
    render(<App />);
    await screen.findByText("Artwork & Files");
    fireEvent.click(screen.getByRole("button", { name: /Capture Photo/ }));
    expect(await screen.findByText(/permission was denied/i)).toBeTruthy();
    expect(screen.getByLabelText("Upload attachment")).toBeTruthy();
  });

  it("annotates image attachments with normalized coordinates, undo redo clear, unsaved warnings, and separate derivative save", async () => {
    mockCanvas({ blobText: "annotated" });
    const createObjectURL = vi.fn(() => "blob:annotation");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const fetch = mockImageWorkspaceFetch({
      attachments: [
        imageAttachment({ id: "image-1", source_type: "device_capture" }),
        imageAttachment({ id: "annotation-1", original_filename: "site-photo-annotated.png", source_type: "annotation_derivative", original_attachment_id: "image-1", derivative_type: "annotation" }),
        { id: "text-1", original_filename: "notes.txt", mime_type: "text/plain", byte_size: 5, previewable: true, annotatable: false, source_type: "upload" },
      ],
    });
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<App />);

    await screen.findByText("Original / Captured");
    expect(screen.getAllByRole("button", { name: /Annotate/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Original/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments/image-1/preview", expect.any(Object)));
    fireEvent.click(screen.getAllByRole("button", { name: /Annotate/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: /Annotate site-photo.png/ });
    fireEvent.load(dialog.querySelector(".annotation-canvas-wrap img"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Rectangle/ }));
    const canvas = within(dialog).getByLabelText("Annotation canvas");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 80, pointerId: 1 });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(screen.getByRole("dialog", { name: /Annotate site-photo.png/ })).toBeTruthy();
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved annotation work?");
    window.confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /Undo/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Redo/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Clear/ }));
    expect(window.confirm).toHaveBeenCalledWith("Clear all annotations?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Pen/ }));
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 25, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 75, clientY: 75, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 75, clientY: 75, pointerId: 2 });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Annotated Copy/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/attachments/image-1/annotations", expect.objectContaining({ method: "POST" })));
    const saveCall = fetch.mock.calls.find(([url]) => url === "/api/orders/order-1/attachments/image-1/annotations");
    const operations = JSON.parse(saveCall[1].body.get("annotation_json"));
    expect(operations[0].points[0]).toMatchObject({ x: 0.25, y: 0.25 });
    expect(saveCall[1].body.get("file").type).toBe("image/png");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:annotation");
  });

  it("renders the Workspace as a dialog overlay over the mounted Orders list", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByLabelText(/Order Workspace O-00001/)).toBeTruthy();
    expect(document.querySelector(".sidebar")).toBeNull();
    expect(screen.getByRole("dialog", { name: /O-00001/ })).toBeTruthy();
    expect(document.querySelector(".stage-background").hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".content-stage").classList.contains("overlay-open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.querySelector(".stage-background h2")?.textContent).toBe("Orders");
    expect(screen.getByText("Order Items")).toBeTruthy();
  });

  it("keeps the Order Workspace as the only scrolling workspace region", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /O-00001/ })).toBeTruthy();
    expect(cssRule(".order-workspace.command-center")).toContain("overflow-y: auto");
    expect(cssRule(".order-workspace.command-center")).toContain("overflow-x: hidden");
    expect(cssRule(".order-dashboard-grid")).not.toMatch(/overflow\s*:/);
    expect(cssRule(".order-items-region")).not.toMatch(/overflow\s*:/);
    expect(cssRule(".workspace-item-table")).toContain("overflow: visible");
    expect(cssRule(".operational-status-region")).not.toMatch(/overflow\s*:/);
    expect(cssRule(".workspace-card")).not.toMatch(/overflow\s*:/);
    expect(cssRule(".workspace-item-table")).not.toMatch(/height\s*:|max-height\s*:/);
  });

  it("renders compact icon-over-label ribbon commands without group captions", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    const ribbon = await screen.findByLabelText("Order workspace ribbon");
    const save = within(ribbon).getByRole("button", { name: /^Save$/ });
    expect(save.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(save.lastElementChild?.tagName.toLowerCase()).toBe("span");
    const ribbonCommandRule = cssRules(".ribbon-button").find((rule) => rule.includes("flex-direction: column"));
    expect(ribbonCommandRule).toContain("width: 56px");
    expect(ribbonCommandRule).toContain("height: 56px");
    expect(ribbonCommandRule).toContain("font-size: 11px");
    expect(readFileSync(join(process.cwd(), "src/styles.css"), "utf8")).not.toContain(".ribbon-group-label");
    expect(within(ribbon).queryByText("Record")).toBeNull();
    expect(within(ribbon).queryByText("Items")).toBeNull();
    expect(cssRule(".office-ribbon")).toContain("max-height: 82px");
    expect(cssRule(".office-ribbon")).toContain("overflow-x: auto");
    expect(cssRule(".office-ribbon")).not.toContain("justify-content: space-between");
  });

  it("flows Order Items above operational cards without duplicate workspace actions", async () => {
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    const workspace = await screen.findByRole("dialog", { name: /O-00001/ });
    const itemRegion = workspace.querySelector('[data-region="order-items"]');
    const operationalRegion = workspace.querySelector('[data-region="operational-status"]');
    expect(itemRegion.compareDocumentPosition(operationalRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cssRule(".order-dashboard-grid")).toContain('"items items items"');
    expect(cssRule(".order-dashboard-grid")).toContain('"operational operational operational"');
    expect(cssRule(".operational-status-region")).toContain("repeat(4, minmax(0, 1fr))");
    expect(within(workspace).queryByRole("button", { name: /Upload Artwork/ })).toBeNull();
    expect(within(workspace).queryByRole("button", { name: /Schedule Install/ })).toBeNull();
    expect(within(workspace).queryByRole("button", { name: /Create\/Open Invoice/ })).toBeNull();
  });

  it("guards dirty hash navigation and restores the Workspace route when cancelled", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Info");
    const workspace = screen.getByLabelText(/Order Workspace O-00001/);
    const notes = within(workspace).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Unsaved note" } });
    await screen.findByText(/Unsaved/);
    window.location.hash = "#/production";
    fireEvent(window, new HashChangeEvent("hashchange"));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("Discard unsaved Order Workspace changes?"));
    await waitFor(() => expect(window.location.hash).toBe("#/orders/order-1"));
    expect(screen.getByRole("dialog", { name: /Order Workspace O-00001/ })).toBeTruthy();
  });

  it("asks exactly once when dirty Back is confirmed and returns to Orders", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Info");
    const workspace = screen.getByLabelText(/Order Workspace O-00001/);
    fireEvent.change(within(workspace).getByLabelText("Internal notes"), { target: { value: "Needs proof" } });
    await screen.findByText(/Unsaved/);
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("asks exactly once when dirty Escape close is canceled and preserves values", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Info");
    const workspace = screen.getByLabelText(/Order Workspace O-00001/);
    const notes = within(workspace).getByLabelText("Internal notes");
    fireEvent.change(notes, { target: { value: "Still editing" } });
    await screen.findByText(/Unsaved/);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/orders/order-1");
    expect(notes.value).toBe("Still editing");
    expect(screen.getByRole("dialog", { name: /Order Workspace O-00001/ })).toBeTruthy();
  });

  it("closes a clean Workspace without confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mockAuthenticatedApp({ route: "/orders/order-1" });
    render(<App />);

    await screen.findByText("Order Info");
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returns focus to the matching Orders Open button after close", async () => {
    mockAuthenticatedApp({ route: "/orders" });
    render(<App />);

    const open = await screen.findByText("Open");
    fireEvent.click(open);
    await screen.findByText("Order Info");
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/orders"));
    await waitFor(() => expect(document.activeElement?.dataset.focusTarget).toBe("order-open-order-1"));
  });

  it("returns to Production when the Workspace was opened from Production", async () => {
    mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    fireEvent.click(await screen.findByText("Open Order"));
    expect(await screen.findByLabelText(/Order Workspace O-00001/)).toBeTruthy();
    expect(screen.getByText("Return: Production")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await waitFor(() => expect(window.location.hash).toBe("#/production"));
  });

  it("returns focus to the matching Production Open Order button after close", async () => {
    mockAuthenticatedApp({ route: "/production" });
    render(<App />);

    fireEvent.click(await screen.findByText("Open Order"));
    await screen.findByText("Order Info");
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

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
    expect(await screen.findByText("Calculator")).toBeTruthy();
    fireEvent.click(screen.getByText("Calculator"));
    fireEvent.click(screen.getByText("7"));
    fireEvent.click(screen.getByText("+"));
    fireEvent.click(screen.getByText("8"));
    fireEvent.click(screen.getByText("="));
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("Copy Result")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("downloads Quote PDFs through authenticated Blob API calls", async () => {
    const clickedLinks = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "a") vi.spyOn(element, "click").mockImplementation(() => clickedLinks.push(element));
      return element;
    });
    const fetch = vi.fn((url) => {
      const path = String(url);
      if (path === "/api/auth/register") return Promise.resolve(jsonResponse({
        access_token: "token",
        user: { role: "owner" },
        tenant: { company_name: "Acme Signs" },
      }));
      if (path === "/api/customers") return Promise.resolve(jsonResponse({ items: [] }));
      if (path === "/api/settings") return Promise.resolve(jsonResponse({ users: [] }));
      if (path === "/api/estimates") return Promise.resolve(jsonResponse({ items: [{ id: "estimate-1", estimate_number: "E-00001", status: "draft", total_cents: 1200 }] }));
      if (path === "/api/estimates/estimate-1/pdf") return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/pdf" }),
        blob: async () => new Blob(["pdf"], { type: "application/pdf" }),
      });
      return Promise.resolve(jsonResponse({ items: [] }));
    });
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    fireEvent.click(await screen.findByText("Register"));
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "password123" } });
    window.location.hash = "#/estimates";
    fireEvent(window, new HashChangeEvent("hashchange"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(await screen.findByText("PDF"));
    expect(fetch).toHaveBeenLastCalledWith("/api/estimates/estimate-1/pdf", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    await waitFor(() => expect(clickedLinks.some((link) => link.download === "quote-E-00001.pdf")).toBe(true));
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

  it("renders Stage 5-6 employee, time, payroll, and portal workflows from authenticated APIs", async () => {
    const fetch = mockAuthenticatedApp({ route: "/employees" });
    render(<App />);

    expect(await screen.findByText("Employee Administration")).toBeTruthy();
    expect(screen.getByText(/EMP-0001/)).toBeTruthy();
    expect(screen.getByText(/\$18.00\/hr/)).toBeTruthy();

    window.location.hash = "#/time";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByText("Currently Clocked In")).toBeTruthy();
    expect(screen.getByText("Time Entries")).toBeTruthy();
    expect(screen.getByText("2026-08-16 08:00 - 2026-08-16 10:00")).toBeTruthy();
    expect(screen.getAllByText(/2.00 hrs/).length).toBeGreaterThanOrEqual(2);
    vi.spyOn(window, "prompt").mockReturnValue("Timezone-safe correction");
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/time/entries/time-entry-1", expect.objectContaining({ method: "PATCH" })));
    const correctionCall = fetch.mock.calls.find(([url, options]) => url === "/api/time/entries/time-entry-1" && options?.method === "PATCH");
    expect(JSON.parse(correctionCall[1].body)).toEqual({
      clock_in_at: "2026-08-16T12:00:00.000Z",
      clock_out_at: "2026-08-16T14:00:00.000Z",
      reason: "Timezone-safe correction",
    });

    window.location.hash = "#/payroll";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByText("Internal Pay Summary")).toBeTruthy();
    expect(await screen.findByText("$23.50")).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Amount")[0], { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Reason or note"), { target: { value: "Lunch advance" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Advance" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/payroll/advances", expect.objectContaining({ method: "POST" })));

    window.location.hash = "#/employee-portal/time-clock";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Time Clock")).length).toBeGreaterThan(0);
    expect(screen.getByText("Clocked out")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Work note"), { target: { value: "Starting install" } });
    fireEvent.click(screen.getByRole("button", { name: /Clock In/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/clock-in", expect.objectContaining({ method: "POST" })));

    window.location.hash = "#/employee-portal/my-pay";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("My Pay")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$23.50").length).toBeGreaterThan(0);
  });

  it("renders Stage 7-8 announcement management and employee portal messaging workflows", async () => {
    const fetch = mockAuthenticatedApp({ route: "/announcements" });
    render(<App />);

    expect(await screen.findByText("Employee Announcements")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New policy" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Clock out before leaving." } });
    fireEvent.click(screen.getByRole("button", { name: "Post Announcement" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/announcements", expect.objectContaining({ method: "POST" })));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save Announcement" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/announcements/announcement-1/archive", expect.objectContaining({ method: "POST" })));

    window.location.hash = "#/employee-portal/announcements";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Announcements")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Shop Meeting/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/announcements/announcement-1", expect.anything()));
    expect(await screen.findByText("Meet at 8 before installs.")).toBeTruthy();

    window.location.hash = "#/employee-portal/messages";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Messages")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Owner User/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/messages/user-1", expect.anything()));
    expect((await screen.findAllByText("Can you check this order?")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "On it." } });
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/messages", expect.objectContaining({ method: "POST" })));
  });

  it("switches between employee portal tabs without hook-order runtime errors", async () => {
    mockAuthenticatedApp({ route: "/employee-portal/time-clock" });
    render(<App />);

    expect((await screen.findAllByText("Time Clock")).length).toBeGreaterThan(0);
    window.location.hash = "#/employee-portal/my-pay";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("My Pay")).length).toBeGreaterThan(0);
    window.location.hash = "#/employee-portal/messages";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Messages")).length).toBeGreaterThan(0);
    window.location.hash = "#/employee-portal/announcements";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Announcements")).length).toBeGreaterThan(0);
    window.location.hash = "#/employee-portal/time-clock";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Time Clock")).length).toBeGreaterThan(0);
  });

  it("keeps message composer recipient aligned with the displayed conversation", async () => {
    const fetch = mockAuthenticatedApp({
      route: "/employee-portal/messages",
      participantItems: [
        { user_id: "user-1", display_name: "Owner User", employee_id: "employee-owner", role: "owner" },
        { user_id: "user-3", display_name: "Manager User", employee_id: "employee-manager", role: "manager" },
      ],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Owner User/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/messages/user-1", expect.anything()));
    fireEvent.change(await screen.findByLabelText("To"), { target: { value: "user-3" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/employee-portal/messages/user-3", expect.anything()));
    expect(await screen.findByText("Please check install timing.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "On it." } });
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
    await waitFor(() => {
      const post = fetch.mock.calls.find(([url, options]) => url === "/api/employee-portal/messages" && options?.method === "POST");
      expect(JSON.parse(post[1].body).recipient_user_id).toBe("user-3");
    });
  });

  it("surfaces participant loading failures and disables message sending", async () => {
    mockAuthenticatedApp({ route: "/employee-portal/messages", participantsError: true });
    render(<App />);

    expect(await screen.findByText(/Recipients unavailable: participant_failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send Message" }).disabled).toBe(true);
  });

  it("formats announcement datetimes in shop time and submits canonical instants", async () => {
    const timed = { ...announcement, expires_at: "2026-08-21T16:00:00.000Z" };
    const fetch = mockAuthenticatedApp({ route: "/announcements", announcementItems: [timed] });
    render(<App />);

    expect(await screen.findByText("Employee Announcements")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Publish").value).toBe("2026-08-21T08:00");
    expect(screen.getByLabelText("Expires").value).toBe("2026-08-21T12:00");
    fireEvent.click(screen.getByRole("button", { name: "Save Announcement" }));
    await waitFor(() => {
      const patch = fetch.mock.calls.find(([url, options]) => String(url).startsWith("/api/announcements/") && options?.method === "PATCH");
      const body = JSON.parse(patch[1].body);
      expect(body.publish_at).toBe("2026-08-21T12:00:00.000Z");
      expect(body.expires_at).toBe("2026-08-21T16:00:00.000Z");
    });
  });

  it("derives announcement management status from archive and publication windows", async () => {
    mockAuthenticatedApp({ route: "/announcements", announcementItems: [announcement, scheduledAnnouncement, expiredAnnouncement, archivedAnnouncement] });
    render(<App />);

    expect(await screen.findByText("All employees / Active")).toBeTruthy();
    expect(screen.getByText("All employees / Scheduled")).toBeTruthy();
    expect(screen.getByText("All employees / Expired")).toBeTruthy();
    expect(screen.getByText("All employees / Archived")).toBeTruthy();
  });

  it("redirects staff away from manager-only employee time routes", async () => {
    mockAuthenticatedApp({ role: "staff", route: "/time" });
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#/production"));
    expect(screen.queryByText("Time Entries")).toBeNull();
    expect(screen.queryByRole("link", { name: "Employees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Time & Attendance" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Payroll" })).toBeNull();
  });

  it("loads Payroll for pay-enabled staff without requiring employee-management access", async () => {
    const fetch = mockAuthenticatedApp({ role: "staff", capabilities: { ...defaultCapabilities("staff"), can_manage_pay: true }, route: "/payroll" });
    render(<App />);

    expect(await screen.findByText("Internal Pay Summary")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/payroll/employees", expect.anything()));
    expect(fetch.mock.calls.some(([url]) => url === "/api/employees")).toBe(false);
    expect(await screen.findByText("$23.50")).toBeTruthy();
  });

  it("redirects Payroll unless the session has pay-management capability", async () => {
    mockAuthenticatedApp({ role: "manager", route: "/payroll" });
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#/invoices"));
    expect(screen.queryByText("Internal Pay Summary")).toBeNull();

    cleanup();
    mockAuthenticatedApp({ role: "manager", capabilities: { ...defaultCapabilities("manager"), can_manage_pay: true }, route: "/payroll" });
    render(<App />);
    expect(await screen.findByText("Internal Pay Summary")).toBeTruthy();
  });

  it("redirects Employee Portal unless the user has an active portal employee capability", async () => {
    mockAuthenticatedApp({ role: "admin", capabilities: { ...defaultCapabilities("admin"), can_use_employee_portal: false }, route: "/employee-portal/messages" });
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(screen.queryByText("Messages")).toBeNull();
    expect(screen.queryByRole("link", { name: "Employee Portal" })).toBeNull();
  });

  it("redirects staff away from announcement management while keeping portal announcements available", async () => {
    mockAuthenticatedApp({ role: "staff", route: "/announcements" });
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#/production"));
    expect(screen.queryByText("Employee Announcements")).toBeNull();
    window.location.hash = "#/employee-portal/announcements";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect((await screen.findAllByText("Announcements")).length).toBeGreaterThan(0);
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
