import { createHash, createHmac, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { documentTotals, formatCents, lineTotalCents, paymentStatus } from "./money.js";
import { hashPassword, hashToken, newSessionToken, sessionExpiry, verifyPassword } from "./security.js";
import { renderPdf } from "./pdf.js";
import { backupHistory, createEncryptedBackup, previewBackup, restoreBackup } from "./backup.js";

const ROLES = ["owner", "admin", "manager", "staff"];
const WRITE_ROLES = new Set(ROLES);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const PRODUCTION_STAGES = ["not_started", "ready", "in_progress", "waiting", "complete"];
const ACTIVE_REOPEN_STAGE = "in_progress";
const CALENDAR_STATUSES = ["scheduled", "complete", "cancelled"];
const CALENDAR_ENTRY_TYPES = ["event", "task", "appointment"];
const CALENDAR_FEED_TYPES = [...CALENDAR_ENTRY_TYPES, "production", "deadline"];
const SCHEDULE_CATEGORIES = ["general", "production", "installation", "sales", "customer_appointment", "site_survey", "pickup", "delivery", "meeting", "deadline", "other"];
const RESOURCE_TYPES = ["equipment", "vehicle", "production_area", "installation_crew", "other"];
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
const LINKED_RECORD_TYPES = ["all", "none", "estimate", "order", "order_item", "work_order"];
const PRODUCTION_GROUPING_MODES = ["whole_order", "individual_items", "custom_groups"];
const BUNDLE_DOCUMENT_TYPES = ["estimate", "order", "invoice"];
const BUNDLE_PRICING_MODES = ["itemized_subtotal", "bundle_price"];
const COMMUNICATION_CHANNELS = ["email", "phone", "walk_in", "manual"];
const INTAKE_STATUSES = ["new", "reviewing", "need_information", "waiting_for_customer", "ready_to_create", "converted_to_order", "attached_to_existing_order", "closed_not_an_order"];
const PAY_WEEK_DAYS = 6;
const IMPLAUSIBLE_SHIFT_MINUTES = 16 * 60;
const PAY_LEDGER_TYPES = ["advance", "adjustment", "manual_payment"];
const ANNOUNCEMENT_AUDIENCES = ["all", ...ROLES];
const FINANCIAL_FIELDS = [
  "unit_price_cents",
  "line_total_cents",
  "subtotal_cents",
  "discount_cents",
  "tax_cents",
  "total_cents",
  "amount_paid_cents",
  "balance_due_cents",
  "manual_total_cents",
  "allocated_cents",
  "allocation_snapshot",
  "override_reason",
  "historical_amount_paid_note",
];
const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const ANNOTATION_OPERATIONS_LIMIT_BYTES = 120 * 1024;
let lastTimestampMs = 0;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
]);
const IMAGE_ATTACHMENT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const PREVIEW_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "text/plain"]);
const BLOCKED_EXTENSION_RE = /\.(app|apk|bat|cmd|com|cpl|dll|dmg|exe|gadget|hta|html?|iso|jar|js|jse|jsx|lnk|mjs|msi|php|pl|ps1|py|rb|reg|scr|sh|svg|swf|ts|tsx|vb|vbe|vbs|wsf|xml)$/i;
const MIME_EXTENSIONS = {
  "application/pdf": new Set([".pdf"]),
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/gif": new Set([".gif"]),
  "image/webp": new Set([".webp"]),
  "text/plain": new Set([".txt", ".text", ".log"]),
  "text/csv": new Set([".csv"]),
  "application/json": new Set([".json"]),
};

const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(2),
});

const quickItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().min(1),
  quantity_decimal: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/).refine((value) => value !== "0" && value !== "0.0" && value !== "0.00" && value !== "0.000" && value !== "0.0000", "quantity_must_be_positive"),
  unit_price_cents: z.number().int().nonnegative().safe(),
  taxable: z.boolean(),
  production_required: z.boolean(),
  due_date: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
});

const workspaceItemSchema = quickItemSchema.extend({
  production_stage: z.enum(PRODUCTION_STAGES).default("not_started"),
  completed: z.boolean().default(false),
});

const orderWorkspaceSchema = z.object({
  expected_updated_at: z.string().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  document_date: z.string().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).optional(),
  discount_cents: z.number().int().nonnegative().optional(),
  internal_notes: z.string().nullable().optional(),
  items: z.array(workspaceItemSchema).min(1).optional(),
});

const calendarEventSchema = z.object({
  entry_type: z.enum(CALENDAR_ENTRY_TYPES).default("event"),
  schedule_category: z.enum(SCHEDULE_CATEGORIES).default("general"),
  department_id: z.string().nullable().optional(),
  title: z.string().min(1),
  task_priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  appointment_type: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_contact: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  estimate_id: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
  order_item_id: z.string().nullable().optional(),
  work_order_id: z.string().nullable().optional(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  all_day: z.boolean().default(false),
  assigned_user_id: z.string().nullable().optional(),
  assignee_user_ids: z.array(z.string()).optional(),
  primary_assignee_user_id: z.string().nullable().optional(),
  resource_reservations: z.array(z.object({ resource_id: z.string().min(1), quantity: z.number().int().positive().default(1) })).optional(),
  conflict_override: z.boolean().optional(),
  conflict_override_reason: z.string().nullable().optional(),
  status: z.enum(CALENDAR_STATUSES).optional(),
  internal_note: z.string().nullable().optional(),
});

const departmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().min(1).default("#255b73"),
  active: z.boolean().default(true),
  display_order: z.number().int().optional(),
  memberships: z.array(z.object({ user_id: z.string().min(1), primary_department: z.boolean().default(false), active: z.boolean().default(true) })).optional(),
});

const resourceSchema = z.object({
  name: z.string().min(1),
  resource_type: z.enum(RESOURCE_TYPES),
  description: z.string().nullable().optional(),
  capacity: z.number().int().positive().default(1),
  color: z.string().min(1).default("#64748b"),
  active: z.boolean().default(true),
  department_id: z.string().nullable().optional(),
  unavailable: z.array(z.object({ start_at: z.string().min(1), end_at: z.string().min(1), reason: z.string().min(1).default("Unavailable"), hard_block: z.boolean().default(true) })).optional(),
});

const scheduleViewFiltersSchema = z.object({
  schedule_categories: z.array(z.enum(SCHEDULE_CATEGORIES)).default([]),
  entry_types: z.array(z.enum(CALENDAR_ENTRY_TYPES)).default([]),
  department_ids: z.array(z.string()).default([]),
  employee_ids: z.array(z.string()).default([]),
  resource_ids: z.array(z.string()).default([]),
  statuses: z.array(z.enum(CALENDAR_STATUSES)).default([]),
  linked: z.enum(["all", "linked", "unlinked", "estimate", "order", "order_item"]).default("all"),
}).strict();

const workOrderGroupSchema = z.object({
  title: z.string().trim().min(1).max(120),
  item_ids: z.array(z.string().min(1)).min(1),
});

const productionSetupSchema = z.object({
  mode: z.enum(PRODUCTION_GROUPING_MODES),
  groups: z.array(workOrderGroupSchema).optional(),
  independent_item_ids: z.array(z.string().min(1)).optional(),
  reason: z.string().trim().max(500).optional(),
  calendar_resolution: z.enum(["keep_original", "move_to_replacement", "return_to_order", "cancel"]).optional(),
  calendar_resolution_replacement_title: z.string().trim().max(120).optional(),
  calendar_resolution_reason: z.string().trim().max(500).optional(),
});

const bundleSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  display_order: z.number().int().nonnegative().optional(),
  pricing_mode: z.enum(BUNDLE_PRICING_MODES),
  manual_total_cents: z.number().int().nonnegative().nullable().optional(),
  override_reason: z.string().trim().max(500).nullable().optional(),
  show_member_prices: z.boolean().default(true),
  item_ids: z.array(z.string().min(1)).min(1),
});

const scheduleViewSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().min(1).default("#255b73"),
  visibility: z.enum(["shared", "personal"]).default("personal"),
  active: z.boolean().default(true),
  display_order: z.number().int().optional(),
  filters: scheduleViewFiltersSchema,
}).strict();

const emailSettingsSchema = z.object({
  sender_name: z.string().trim().max(120).optional(),
  sender_email: z.string().email().nullable().optional(),
  sendgrid_verified: z.boolean().optional(),
});

const emailSendSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(160),
  to_email: z.string().email().optional(),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().trim().min(1).max(180),
  body_text: z.string().trim().min(1).max(10000),
  confirm_unsaved_recipient: z.boolean().default(false),
  attach_document: z.boolean().default(true),
  order_attachment_ids: z.array(z.string().min(1)).default([]),
});

const manualCommunicationSchema = z.object({
  customer_id: z.string().min(1),
  direction: z.enum(["inbound", "outbound", "internal"]).default("inbound"),
  channel: z.enum(COMMUNICATION_CHANNELS).default("phone"),
  subject: z.string().trim().max(180).nullable().optional(),
  body_text: z.string().trim().min(1).max(10000),
  related_entity_type: z.enum(["customer", "estimate", "order", "invoice", "order_intake"]).nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
});

const intakeUpdateSchema = z.object({
  status: z.enum(INTAKE_STATUSES).optional(),
  customer_id: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  follow_up_at: z.string().nullable().optional(),
  summary: z.string().trim().min(1).max(300).optional(),
  internal_notes: z.string().trim().max(5000).nullable().optional(),
});

const intakeCustomerSchema = z.object({
  contact_name: z.string().trim().min(1).max(120),
  business_name: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  billing_address: addressSchema.optional(),
});

const inboundIntakeSchema = z.object({
  provider_message_id: z.string().trim().min(1).max(240),
  intake_address: z.string().email(),
  sender_name: z.string().trim().max(160).nullable().optional(),
  sender_email: z.string().email(),
  recipients: z.array(z.string().email()).default([]),
  subject: z.string().trim().max(240).default("(no subject)"),
  sent_at: z.string().nullable().optional(),
  received_at: z.string().nullable().optional(),
  text_body: z.string().max(250000).nullable().optional(),
  html_body: z.string().max(250000).nullable().optional(),
  attachments: z.array(z.object({
    original_filename: z.string().trim().min(1).max(180),
    mime_type: z.string().trim().min(1).max(120),
    byte_size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
    content_base64: z.string().max(15000000).nullable().optional(),
  })).default([]),
});

const annotationColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const annotationPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const annotationStrokeSchema = z.number().int().min(1).max(24);
const annotationOperationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().min(1).max(80),
    type: z.literal("pen"),
    color: annotationColorSchema,
    stroke_width: annotationStrokeSchema,
    points: z.array(annotationPointSchema).min(1).max(1000),
  }),
  z.object({
    id: z.string().trim().min(1).max(80),
    type: z.literal("arrow"),
    color: annotationColorSchema,
    stroke_width: annotationStrokeSchema,
    start: annotationPointSchema,
    end: annotationPointSchema,
  }),
  z.object({
    id: z.string().trim().min(1).max(80),
    type: z.literal("rectangle"),
    color: annotationColorSchema,
    stroke_width: annotationStrokeSchema,
    start: annotationPointSchema,
    end: annotationPointSchema,
  }),
  z.object({
    id: z.string().trim().min(1).max(80),
    type: z.literal("text"),
    color: annotationColorSchema,
    stroke_width: annotationStrokeSchema,
    point: annotationPointSchema,
    text: z.string().trim().min(1).max(160),
  }),
]);
const annotationOperationsSchema = z.array(annotationOperationSchema).min(1).max(200);
const employeeSchema = z.object({
  user_id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  email: z.string().email(),
  phone: z.string().trim().max(80).nullable().optional(),
  role: z.enum(ROLES),
  portal_access_enabled: z.boolean().default(true),
  pay_management_enabled: z.boolean().default(false),
  active: z.boolean().default(true),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  internal_note: z.string().trim().max(2000).nullable().optional(),
  hourly_rate_cents: z.number().int().nonnegative().optional(),
  rate_effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const employeeUpdateSchema = employeeSchema.omit({ user_id: true, hourly_rate_cents: true, rate_effective_date: true }).partial();
const employeeRateSchema = z.object({
  hourly_rate_cents: z.number().int().nonnegative(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable().optional(),
});
const clockNoteSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});
const adminTimeEntrySchema = z.object({
  employee_id: z.string().min(1),
  clock_in_at: z.string().trim().min(1),
  clock_out_at: z.string().trim().min(1),
  clock_in_note: z.string().trim().max(500).nullable().optional(),
  clock_out_note: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
const timeCorrectionSchema = z.object({
  clock_in_at: z.string().trim().min(1).optional(),
  clock_out_at: z.string().trim().min(1).nullable().optional(),
  clock_in_note: z.string().trim().max(500).nullable().optional(),
  clock_out_note: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
const payWeekFilterSchema = z.object({
  employee_id: z.string().optional(),
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const advanceSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().positive(),
  advance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(500),
});
const adjustmentSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["positive", "negative"]),
  amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
const manualPaymentSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().positive(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.string().trim().max(80).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
const voidLedgerSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const reopenPayWeekSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  publish_at: z.string().trim().min(1).optional(),
  expires_at: z.string().trim().min(1).nullable().optional(),
  audience_role: z.enum(ANNOUNCEMENT_AUDIENCES).default("all"),
}).strict();
const announcementUpdateSchema = announcementSchema.partial();
const directMessageSchema = z.object({
  recipient_user_id: z.string().trim().min(1),
  body: z.string().trim().min(1).max(4000),
  sender_user_id: z.string().trim().min(1).optional(),
}).strict();

function now() {
  const current = Date.now();
  lastTimestampMs = Math.max(current, lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function payWeekStart(dateString) {
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  const daysSinceSaturday = (date.getUTCDay() + 1) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  return date.toISOString().slice(0, 10);
}

function payWeekEnd(weekStart) {
  return addDays(weekStart, PAY_WEEK_DAYS);
}

function localDateParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localDateForInstant(instant, timezone) {
  const parts = localDateParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timezoneOffsetMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = /^GMT(?:(?<sign>[+-])(?<hour>\d{1,2})(?::(?<minute>\d{2}))?)?$/.exec(name);
  if (!match) return 0;
  const sign = match.groups.sign === "-" ? -1 : 1;
  return sign * (Number(match.groups.hour || 0) * 60 + Number(match.groups.minute || 0));
}

function parseShopDateTime(value, timezone) {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  let utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  for (let i = 0; i < 2; i += 1) utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - timezoneOffsetMinutes(new Date(utcMs), timezone) * 60000;
  return new Date(utcMs).toISOString();
}

function localDateTimeDisplay(value, timezone) {
  if (!value) return "";
  const parts = localDateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function minutesBetween(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

function grossCentsForMinutes(minutes, rateCents) {
  return Math.floor((Number(minutes) * Number(rateCents) + 30) / 60);
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function payWeekStartsForInterval(clockInAt, clockOutAt, timezone) {
  const endExclusiveMs = new Date(clockOutAt).getTime();
  const lastWorkedMs = endExclusiveMs - 1;
  const starts = [];
  let cursor = payWeekStart(localDateForInstant(clockInAt, timezone));
  const finalStart = payWeekStart(localDateForInstant(isoFromMs(lastWorkedMs), timezone));
  while (cursor <= finalStart) {
    starts.push(cursor);
    cursor = addDays(payWeekEnd(cursor), 1);
  }
  return starts;
}

function overlappedMinutes(entry, startUtc, endUtc) {
  const startMs = Math.max(new Date(entry.clock_in_at).getTime(), new Date(startUtc).getTime());
  const endMs = Math.min(new Date(entry.clock_out_at).getTime(), new Date(endUtc).getTime());
  if (endMs <= startMs) return 0;
  return minutesBetween(isoFromMs(startMs), isoFromMs(endMs));
}

function mapEmployee(row, { includePay = false } = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    employee_number: row.employee_number,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    portal_access_enabled: Boolean(row.portal_access_enabled),
    pay_management_enabled: Boolean(row.pay_management_enabled),
    active: Boolean(row.active),
    hire_date: row.hire_date,
    internal_note: row.internal_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includePay) {
    base.current_rate_cents = row.current_rate_cents ?? null;
    base.current_rate_effective_date = row.current_rate_effective_date ?? null;
  }
  return base;
}

function mapTimeEntry(row, timezone = "America/New_York", { includePay = false } = {}) {
  if (!row) return null;
  const entry = {
    id: row.id,
    tenant_id: row.tenant_id,
    employee_id: row.employee_id,
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    clock_in_display: localDateTimeDisplay(row.clock_in_at, timezone),
    clock_out_display: row.clock_out_at ? localDateTimeDisplay(row.clock_out_at, timezone) : "",
    clock_in_note: row.clock_in_note,
    clock_out_note: row.clock_out_note,
    duration_minutes: row.duration_minutes,
    status: row.status,
    implausible: Boolean(row.implausible),
    correction_reason: row.correction_reason,
    void_reason: row.void_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includePay) entry.rate_cents_snapshot = row.rate_cents_snapshot;
  return entry;
}

function mapPayWeek(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    employee_id: row.employee_id,
    week_start_date: row.week_start_date,
    week_end_date: row.week_end_date,
    payday_date: row.payday_date,
    status: row.status,
    opening_carryover_cents: row.opening_carryover_cents,
    valid_minutes: row.valid_minutes,
    valid_hours_decimal: (row.valid_minutes / 60).toFixed(2),
    gross_pay_cents: row.gross_pay_cents,
    positive_adjustments_cents: row.positive_adjustments_cents,
    negative_adjustments_cents: row.negative_adjustments_cents,
    advances_cents: row.advances_cents,
    manual_payments_cents: row.manual_payments_cents,
    estimated_amount_due_cents: row.estimated_amount_due_cents,
    closing_carryover_cents: row.closing_carryover_cents,
    rate_breakdown: parseJson(row.rate_breakdown_json) || [],
    snapshot: parseJson(row.snapshot_json) || null,
    closed_by_user_id: row.closed_by_user_id,
    closed_at: row.closed_at,
    reopened_by_user_id: row.reopened_by_user_id,
    reopened_at: row.reopened_at,
    reopen_reason: row.reopen_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    label: "Internal Pay Summary",
  };
}

function ledgerRow(row, type) {
  return {
    ...row,
    type,
    voided: Boolean(row.voided_at),
  };
}

function mapAnnouncement(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    author_user_id: row.author_user_id,
    author_name: row.author_name || "",
    title: row.title,
    body: row.body,
    publish_at: row.publish_at,
    expires_at: row.expires_at,
    audience_role: row.audience_role,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
    read_at: row.read_at || null,
    unread: !row.read_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessage(row, actorId) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    sender_user_id: row.sender_user_id,
    recipient_user_id: row.recipient_user_id,
    sender_name: row.sender_name || "",
    recipient_name: row.recipient_name || "",
    body: row.body,
    sent_at: row.sent_at,
    recipient_read_at: row.recipient_read_at,
    direction: row.sender_user_id === actorId ? "sent" : "received",
    unread: row.recipient_user_id === actorId && !row.recipient_read_at,
    created_at: row.created_at,
  };
}

function todayInTimeZone(timeZone = "America/New_York") {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return today();
  }
}

function timezoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(hour), Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

function zonedLocalToUtc(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) throw error("invalid_calendar_datetime", 400);
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

function normalizeTimedDateTime(value, timeZone) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value))) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw error("invalid_calendar_datetime", 400);
    return date.toISOString();
  }
  return zonedLocalToUtc(value, timeZone);
}

function localDateFor(value, tenant) {
  if (!value) return null;
  if (dateOnly(value)) return value;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tenant?.shop_timezone || "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value)).reduce((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return String(value).slice(0, 10);
  }
}

function localTimeFor(value, tenant) {
  if (!value || dateOnly(value)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tenant?.shop_timezone || "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value).slice(11, 16);
  }
}

function portable(type) {
  return `sgp_v1_${type}_${randomUUID()}`;
}

function bool(value) {
  return value ? 1 : 0;
}

function inflateBool(row, fields) {
  for (const field of fields) row[field] = Boolean(row[field]);
  return row;
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function listParam(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "" || value === "all") return [];
  return String(value).split(",").map((part) => part.trim()).filter(Boolean);
}

function error(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

function normalizeTitle(value, fallback = "") {
  const title = String(value ?? fallback ?? "").trim().replace(/\s+/g, " ");
  return title.slice(0, 160);
}

function fallbackOrderTitle(row) {
  return normalizeTitle(row?.title, row?.order_number ? `Order ${row.order_number}` : "Order");
}

function fallbackItemTitle(row) {
  return normalizeTitle(row?.title, row?.description || `Item ${(Number(row?.position) || 0) + 1}`);
}

function deriveProductionStatus(workOrders = []) {
  const active = workOrders.filter((entry) => entry.status !== "cancelled");
  if (!active.length) return "not_started";
  if (active.every((entry) => entry.completed || entry.production_stage === "complete")) return "complete";
  if (active.some((entry) => entry.production_stage === "waiting")) return "blocked";
  if (active.some((entry) => entry.completed || !["not_started", "ready"].includes(entry.production_stage))) return "partially_complete";
  if (active.some((entry) => entry.production_stage === "ready")) return "in_progress";
  return "not_started";
}

function canViewFinancials(actor) {
  return MANAGER_ROLES.has(actor?.role);
}

function stripFinancialFields(value) {
  if (Array.isArray(value)) return value.map(stripFinancialFields);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FINANCIAL_FIELDS.includes(key) || /(^|_)(price|total|subtotal|tax|payment|cost|margin|allocation|override_reason)/i.test(key)) continue;
    output[key] = stripFinancialFields(entry);
  }
  return output;
}

function storageRoot() {
  return resolve(process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT || join(process.cwd(), "data", "attachments"));
}

function uploadLimitBytes() {
  const parsed = Number(process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES || DEFAULT_UPLOAD_LIMIT_BYTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_LIMIT_BYTES;
}

function safeFilename(name) {
  const leaf = basename(String(name || "attachment").replace(/\\/g, "/"));
  // Control characters are intentionally stripped from uploaded filenames.
  // eslint-disable-next-line no-control-regex
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+$/, "attachment");
  return cleaned.slice(0, 180) || "attachment";
}

function assertInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}\\`) && !resolved.startsWith(`${resolvedRoot}/`)) {
    throw error("attachment_path_invalid", 400);
  }
  return resolved;
}

function contentDisposition(filename, disposition = "attachment") {
  const safe = safeFilename(filename).replace(/"/g, "'");
  return `${disposition}; filename="${safe}"`;
}

function fileExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

function assertNoSymlinkAncestors(target, stopAt) {
  let current = resolve(target);
  const stop = resolve(stopAt);
  while (current !== stop) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (existsSync(stop) && lstatSync(stop).isSymbolicLink()) throw error("attachment_path_invalid", 400);
}

function readPrefix(path, length = 512) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function assertSafeTextContent(path, mimeType) {
  const buffer = readFileSync(path);
  if (isBinary(buffer)) throw error("attachment_type_not_allowed", 400);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const trimmed = text.trimStart().toLowerCase();
  if (/^(<!doctype\s+html|<html\b|<script\b|<svg\b|<\?xml)/i.test(trimmed)) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "application/json") {
    try {
      JSON.parse(text);
    } catch {
      throw error("attachment_type_not_allowed", 400);
    }
  }
}

function verifyAttachmentContent(path, mimeType) {
  const prefix = readPrefix(path, 512);
  if (mimeType === "application/pdf" && prefix.subarray(0, 5).toString("latin1") !== "%PDF-") throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/png" && !prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/jpeg" && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/gif" && !["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("latin1"))) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/webp" && !(prefix.subarray(0, 4).toString("latin1") === "RIFF" && prefix.subarray(8, 12).toString("latin1") === "WEBP")) throw error("attachment_type_not_allowed", 400);
  if (["text/plain", "text/csv", "application/json"].includes(mimeType)) assertSafeTextContent(path, mimeType);
}

function uint24Le(buffer, offset) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function imageDimensions(path, mimeType) {
  if (!IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) return { width: null, height: null };
  const bytes = readFileSync(path);
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/gif" && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (mimeType === "image/webp" && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { width: uint24Le(bytes, 24) + 1, height: uint24Le(bytes, 27) + 1 };
    if (chunk === "VP8 " && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  throw error("attachment_type_not_allowed", 400);
}

function attachmentSourceType(file) {
  const source = String(file?.fields?.source_type || "upload");
  if (source === "device_capture") return "device_capture";
  return "upload";
}

function annotationOperationsFromField(value) {
  if (typeof value !== "string") throw error("annotation_payload_invalid", 400);
  if (Buffer.byteLength(value, "utf8") > ANNOTATION_OPERATIONS_LIMIT_BYTES) throw error("annotation_payload_too_large", 413);
  if (!value.trim()) throw error("annotation_payload_invalid", 400);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw error("annotation_payload_invalid", 400);
  }
  try {
    return annotationOperationsSchema.parse(parsed);
  } catch {
    throw error("annotation_payload_invalid", 400);
  }
}

function mapTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    slug: row.slug,
    company_name: row.company_name,
    logo_reference: row.logo_reference,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      country: row.country,
    },
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    sales_tax_rate_basis_points: row.sales_tax_rate_basis_points,
    locale: row.locale,
    currency: row.currency,
    shop_timezone: row.shop_timezone,
  };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
  };
}

function mapCustomer(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_number: row.customer_number,
      contact_name: row.contact_name,
      business_name: row.business_name,
      email: row.email,
      phone: row.phone,
      billing_address: {
        line1: row.billing_line1,
        line2: row.billing_line2,
        city: row.billing_city,
        state: row.billing_state,
        postal_code: row.billing_postal_code,
        country: row.billing_country,
      },
      active: row.active,
      tax_exempt: row.tax_exempt,
      tax_exemption_note: row.tax_exemption_note,
      internal_notes: row.internal_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["active", "tax_exempt"],
  );
}

function mapItem(row, ownerKey) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      [ownerKey]: row[ownerKey],
      source_estimate_item_id: row.source_estimate_item_id,
      position: row.position,
      title: fallbackItemTitle(row),
      description: row.description,
      quantity_decimal: row.quantity_decimal,
      unit_price_cents: row.unit_price_cents,
      line_total_cents: row.line_total_cents,
      taxable: row.taxable,
      production_required: row.production_required,
      production_stage: row.production_stage,
      completed: row.completed,
      due_date: row.due_date,
      assigned_user_id: row.assigned_user_id,
      internal_note: row.internal_note,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["taxable", "production_required", "completed"],
  );
}

function productionProgress(items) {
  const productionItems = items.filter((item) => item.production_required);
  const completed = productionItems.filter((item) => item.completed).length;
  const total = productionItems.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : null,
  };
}

function mapEstimate(row, items = []) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      estimate_number: row.estimate_number,
      document_date: row.document_date,
      expires_at: row.expires_at,
      follow_up_at: row.follow_up_at,
      status: row.status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      internal_notes: row.internal_notes,
      converted_order_id: row.converted_order_id,
      items,
    },
    ["customer_tax_exempt_snapshot"],
  );
}

function mapOrder(row, items = []) {
  if (!row) return null;
  const order = inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      source_estimate_id: row.source_estimate_id,
      order_number: row.order_number,
      title: fallbackOrderTitle(row),
      document_date: row.document_date,
      due_date: row.due_date,
      status: row.status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      internal_notes: row.internal_notes,
      production_grouping_mode: row.production_grouping_mode,
      sent_to_production_at: row.sent_to_production_at,
      sent_to_production_by_user_id: row.sent_to_production_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      items,
    },
    ["customer_tax_exempt_snapshot"],
  );
  order.production_progress = productionProgress(items);
  order.production_status = productionProgress(items).total ? (productionProgress(items).completed === productionProgress(items).total ? "complete" : productionProgress(items).completed ? "partially_complete" : "not_started") : "not_started";
  return order;
}

function mapInvoice(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      order_id: row.order_id,
      customer_id: row.customer_id,
      invoice_number: row.invoice_number,
      document_date: row.document_date,
      due_date: row.due_date,
      document_status: row.document_status,
      payment_status: row.payment_status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      amount_paid_cents: row.amount_paid_cents,
      balance_due_cents: row.balance_due_cents,
      historical_amount_paid_note: row.historical_amount_paid_note,
    },
    ["customer_tax_exempt_snapshot"],
  );
}

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    order_id: row.order_id,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
    source_type: row.source_type || "upload",
    original_attachment_id: row.original_attachment_id || null,
    derivative_type: row.derivative_type || null,
    image_width: row.image_width || null,
    image_height: row.image_height || null,
    annotation_operations: parseJson(row.annotation_json) || null,
    annotatable: IMAGE_ATTACHMENT_MIME_TYPES.has(row.mime_type),
    previewable: PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type),
  };
}

function mapEmailSettings(row, tenant = null) {
  return {
    sender_name: row?.sender_name || tenant?.company_name || "",
    sender_email: row?.sender_email || tenant?.contact_email || null,
    sendgrid_verified: Boolean(row?.sendgrid_verified),
    configured: Boolean(row?.sender_email || tenant?.contact_email),
    provider_ready: Boolean(process.env.SIGNGUY_SLIM_SENDGRID_API_KEY),
    updated_at: row?.updated_at || null,
  };
}

function mapOutboundEmail(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      idempotency_key: row.idempotency_key,
      customer_id: row.customer_id,
      related_entity_type: row.related_entity_type,
      related_entity_id: row.related_entity_id,
      message_type: row.message_type,
      sender_user_id: row.sender_user_id,
      from_email: row.from_email,
      from_name: row.from_name,
      to_email: row.to_email,
      cc: parseJson(row.cc_json) || [],
      subject: row.subject,
      body_text: row.body_text,
      provider: row.provider,
      provider_message_id: row.provider_message_id,
      delivery_state: row.delivery_state,
      failure_reason: row.failure_reason,
      document_attached: row.document_attached,
      order_attachment_ids: parseJson(row.order_attachment_ids_json) || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["document_attached"],
  );
}

function mapCommunication(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    direction: row.direction,
    channel: row.channel,
    activity_type: row.activity_type,
    author_user_id: row.author_user_id,
    sender_email: row.sender_email,
    recipient_emails: parseJson(row.recipient_emails_json) || [],
    subject: row.subject,
    body_text: row.body_text,
    summary: row.summary,
    related_entity_type: row.related_entity_type,
    related_entity_id: row.related_entity_id,
    outbound_email_send_id: row.outbound_email_send_id,
    intake_item_id: row.intake_item_id,
    delivery_state: row.delivery_state,
    created_at: row.created_at,
  };
}

function mapIntakeAddress(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      tenant_id: row.tenant_id,
      full_address: row.full_address,
      active: row.active,
      rotated_at: row.rotated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["active"],
  );
}

function mapIntakeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    provider: row.provider,
    provider_message_id: row.provider_message_id,
    intake_address: row.intake_address,
    sender_name: row.sender_name,
    sender_email: row.sender_email,
    recipients: parseJson(row.recipients_json) || [],
    subject: row.subject,
    sent_at: row.sent_at,
    received_at: row.received_at,
    text_body: row.text_body,
    html_body: row.html_body,
    sanitized_html: row.sanitized_html,
    receipt_status: row.receipt_status,
    created_at: row.created_at,
  };
}

function mapIntakeItem(row, source = null, attachments = []) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    source_message_id: row.source_message_id,
    customer_id: row.customer_id,
    assigned_user_id: row.assigned_user_id,
    status: row.status,
    summary: row.summary,
    follow_up_at: row.follow_up_at,
    converted_order_id: row.converted_order_id,
    linked_order_id: row.linked_order_id,
    converted_by_user_id: row.converted_by_user_id,
    converted_at: row.converted_at,
    internal_notes: row.internal_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source_message: source,
    sender_email: source?.sender_email || row.sender_email || null,
    sender_name: source?.sender_name || row.sender_name || null,
    subject: source?.subject || row.subject || null,
    received_at: source?.received_at || row.received_at || null,
    attachments,
    customer_summary: row.customer_contact_name ? {
      id: row.customer_id,
      contact_name: row.customer_contact_name,
      business_name: row.customer_business_name,
      email: row.customer_email,
    } : null,
    assignee_name: row.assignee_name || null,
    converted_order_number: row.converted_order_number || null,
    linked_order_number: row.linked_order_number || null,
  };
}

function mapIntakeAttachment(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      tenant_id: row.tenant_id,
      source_message_id: row.source_message_id,
      original_filename: row.original_filename,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      sha256: row.sha256,
      order_attachment_id: row.order_attachment_id,
      accepted: row.accepted,
      rejection_reason: row.rejection_reason,
      created_at: row.created_at,
    },
    ["accepted"],
  );
}

function sanitizeHtmlFragment(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hmacHex(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function verifySharedSecretSignature({ secret, payload, signature, required, errorCode }) {
  if (!secret) {
    if (required) throw error(errorCode, 401);
    return true;
  }
  const expected = hmacHex(secret, payload);
  if (!signature || expected !== String(signature).replace(/^sha256=/, "")) throw error(errorCode, 401);
  return true;
}

function mapCalendarEvent(row, tenant = null) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      source_type: row.source_type || row.entry_type || "event",
      entry_type: row.entry_type || "event",
      schedule_category: row.schedule_category || "general",
      department_id: row.department_id,
      department_name: row.department_name,
      department_color: row.department_color,
      derived: Boolean(row.derived),
      title: row.title,
      task_priority: row.task_priority,
      appointment_type: row.appointment_type,
      customer_name: row.customer_name,
      customer_contact: row.customer_contact,
      location: row.location,
      estimate_id: row.estimate_id,
      estimate_number: row.estimate_number,
      order_id: row.order_id,
      order_item_id: row.order_item_id,
      work_order_id: row.work_order_id,
      start_at: row.start_at,
      end_at: row.end_at,
      all_day: row.all_day,
      assigned_user_id: row.assigned_user_id,
      assignees: row.assignees || [],
      resource_reservations: row.resource_reservations || [],
      conflicts: row.conflicts || [],
      conflict_override_reason: row.conflict_override_reason,
      status: row.status,
      internal_note: row.internal_note,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      local_start_date: localDateFor(row.start_at, tenant),
      local_end_date: localDateFor(row.end_at, tenant),
      local_start_time: localTimeFor(row.start_at, tenant),
      local_end_time: localTimeFor(row.end_at, tenant),
      order_number: row.order_number,
      order_title: row.order_title,
      item_title: row.item_title,
      item_description: row.item_description,
      work_order_title: row.work_order_title,
      work_order_number: row.work_order_number,
      display_title: row.title || row.work_order_title || row.item_title || row.order_title || row.order_number || row.item_description,
      assigned_user_name: row.assigned_user_name,
    },
    ["all_day"],
  );
}

function mapWorkOrder(row, items = [], schedules = []) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      order_id: row.order_id,
      work_order_number: row.work_order_number,
      title: fallbackOrderTitle(row),
      grouping_mode: row.grouping_mode,
      production_stage: row.production_stage,
      completed: row.completed,
      status: row.status,
      due_date: row.due_date,
      assigned_user_id: row.assigned_user_id,
      department_id: row.department_id,
      instructions_snapshot: parseJson(row.instructions_snapshot_json) || {},
      created_by_user_id: row.created_by_user_id,
      sent_to_production_at: row.sent_to_production_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      order_number: row.order_number,
      order_title: fallbackOrderTitle({ title: row.order_title, order_number: row.order_number }),
      order_status: row.order_status,
      customer_name: row.business_name || row.contact_name || row.customer_name,
      assigned_user_name: row.assigned_user_name,
      department_name: row.department_name,
      item_count: Number(row.item_count ?? items.length ?? 0),
      items,
      scheduled_entries: schedules,
    },
    ["completed"],
  );
}

function mapBundle(row, items = []) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      document_type: row.document_type,
      document_id: row.document_id,
      source_order_id: row.source_order_id,
      title: row.title,
      description: row.description,
      display_order: row.display_order,
      pricing_mode: row.pricing_mode,
      manual_total_cents: row.manual_total_cents,
      override_reason: row.override_reason,
      show_member_prices: row.show_member_prices,
      allocation_snapshot: parseJson(row.allocation_snapshot_json) || {},
      active: row.active,
      items,
      total_cents: row.pricing_mode === "bundle_price" ? row.manual_total_cents : items.reduce((sum, item) => sum + (item.line_total_cents || 0), 0),
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["show_member_prices", "active"],
  );
}

function mapDepartment(row, memberships = []) {
  if (!row) return null;
  return inflateBool({
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description,
    color: row.color,
    active: row.active,
    display_order: row.display_order,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    memberships,
  }, ["active"]);
}

function mapResource(row, unavailable = []) {
  if (!row) return null;
  return inflateBool({
    id: row.id,
    tenant_id: row.tenant_id,
    department_id: row.department_id,
    department_name: row.department_name,
    name: row.name,
    resource_type: row.resource_type,
    description: row.description,
    capacity: row.capacity,
    color: row.color,
    active: row.active,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    unavailable,
  }, ["active"]);
}

function mapScheduleView(row) {
  if (!row) return null;
  return inflateBool({
    id: row.id,
    tenant_id: row.tenant_id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description,
    color: row.color,
    visibility: row.visibility,
    system_key: row.system_key,
    system_protected: Boolean(row.system_key),
    active: row.active,
    display_order: row.display_order,
    filters: parseJson(row.filters_json),
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }, ["active", "system_protected"]);
}

export class SlimService {
  constructor(db, options = {}) {
    this.db = db;
    this.inTransaction = false;
    this.emailTransport = options.emailTransport || null;
  }

  attachmentPath(storageKey) {
    const root = storageRoot();
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    const realRoot = realpathSync(root);
    assertNoSymlinkAncestors(realRoot, dirname(realRoot));
    const fullPath = assertInside(realRoot, join(realRoot, storageKey));
    const parent = dirname(fullPath);
    mkdirSync(parent, { recursive: true });
    assertNoSymlinkAncestors(parent, realRoot);
    if (existsSync(fullPath) && lstatSync(fullPath).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    return fullPath;
  }

  transaction(work) {
    if (this.inTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  nextNumber(tenantId, sequenceName, prefix) {
    this.db
      .prepare("INSERT OR IGNORE INTO tenant_sequences (tenant_id, sequence_name, next_value) VALUES (?, ?, 1)")
      .run(tenantId, sequenceName);
    const row = this.db
      .prepare("SELECT next_value FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = ?")
      .get(tenantId, sequenceName);
    this.db
      .prepare("UPDATE tenant_sequences SET next_value = next_value + 1 WHERE tenant_id = ? AND sequence_name = ?")
      .run(tenantId, sequenceName);
    return `${prefix}-${String(row.next_value).padStart(5, "0")}`;
  }

  audit(actor, action, entityType, entityId, entityPortableId, summary, diff = null) {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, portable_id, tenant_id, actor_user_id, action, entity_type, entity_id, entity_portable_id, summary, diff_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        portable("audit_event"),
        actor.tenant_id,
        actor.id,
        action,
        entityType,
        entityId,
        entityPortableId,
        summary,
        diff ? JSON.stringify(diff) : null,
        now(),
      );
  }

  auditSystem(tenantId, action, entityType, entityId, entityPortableId, summary, diff = null) {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, portable_id, tenant_id, actor_user_id, action, entity_type, entity_id, entity_portable_id, summary, diff_json, occurred_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), portable("audit_event"), tenantId, action, entityType, entityId, entityPortableId, summary, diff ? JSON.stringify(diff) : null, now());
  }

  requireRole(actor, allowed) {
    if (!actor || !allowed.has(actor.role) || !actor.active) throw error("permission_denied", 403);
  }

  requireBackupRole(actor) {
    this.requireRole(actor, ADMIN_ROLES);
  }

  createBackup(actor, payload) {
    try {
      return createEncryptedBackup(this, actor, payload);
    } catch (err) {
      if (actor?.tenant_id && actor?.id && actor?.role && ADMIN_ROLES.has(actor.role)) {
        this.audit(actor, "backup.failed", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Slim backup failed", { error: err.message });
      }
      throw err;
    }
  }

  previewBackup(actor, file, payload) {
    try {
      return previewBackup(this, actor, file, payload?.passphrase || "");
    } catch (err) {
      if (actor?.tenant_id && actor?.id && actor?.role && ADMIN_ROLES.has(actor.role)) {
        this.audit(actor, "backup.validation_failed", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Slim backup validation failed", { error: err.message });
      }
      throw err;
    }
  }

  restoreBackup(actor, file, payload) {
    return restoreBackup(this, actor, file, payload);
  }

  backupHistory(actor) {
    return backupHistory(this, actor);
  }

  async registerTenant(payload) {
    const input = z
      .object({
        tenant_name: z.string().min(1),
        tenant_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        owner_email: z.string().email(),
        owner_name: z.string().min(1),
        owner_password: z.string().min(8).max(128),
        sales_tax_rate_basis_points: z.number().int().min(0).max(10000).default(0),
        locale: z.string().min(2).default("en-US"),
        currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
        shop_timezone: z.string().min(1).default("America/New_York"),
      })
      .parse(payload);
    const tenantId = randomUUID();
    const userId = randomUUID();
    const created = now();
    const passwordHash = await hashPassword(input.owner_password);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO tenants
           (id, portable_id, slug, company_name, sales_tax_rate_basis_points, locale, currency, shop_timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tenantId,
          portable("tenant"),
          input.tenant_slug,
          input.tenant_name,
          input.sales_tax_rate_basis_points,
          input.locale,
          input.currency,
          input.shop_timezone,
          created,
          created,
        );
      this.db
        .prepare(
          `INSERT INTO users (id, portable_id, tenant_id, display_name, email, password_hash, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'owner', 1, ?, ?)`,
        )
        .run(userId, portable("user"), tenantId, input.owner_name, input.owner_email.toLowerCase(), passwordHash, created, created);
      const intakeAddress = this.composeIntakeAddress(input.tenant_slug, randomUUID().replace(/-/g, ""));
      this.db
        .prepare(
          `INSERT INTO tenant_intake_addresses
           (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(randomUUID(), tenantId, intakeAddress.token, intakeAddress.full, userId, created, created);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err.message).includes("UNIQUE")) throw error("tenant_or_user_exists", 409);
      throw err;
    }
    const actor = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
    this.audit(actor, "tenant.create", "tenant", tenantId, this.tenant(tenantId).portable_id, `Tenant ${input.tenant_name} created`);
    return this.issueSession(actor);
  }

  async login(payload) {
    const input = z
      .object({ tenant_slug: z.string().min(1), email: z.string().email(), password: z.string().min(1) })
      .parse(payload);
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE slug = ?").get(input.tenant_slug);
    const generic = error("invalid_shop_email_or_password", 401);
    if (!tenant) throw generic;
    const user = this.db
      .prepare("SELECT * FROM users WHERE tenant_id = ? AND email = ?")
      .get(tenant.id, input.email.toLowerCase());
    if (!user || !user.active || !(await verifyPassword(input.password, user.password_hash))) throw generic;
    return this.issueSession(mapUser(user));
  }

  issueSession(user) {
    const token = newSessionToken();
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sessions (id, tenant_id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, user.tenant_id, user.id, hashToken(token), now(), sessionExpiry());
    return { access_token: token, token_type: "bearer", ...this.sessionPayload(user) };
  }

  sessionPayload(user) {
    return { user, tenant: this.tenant(user.tenant_id), capabilities: this.capabilitiesForActor(user) };
  }

  actorForToken(token) {
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashToken(token || ""), now());
    if (!row || !row.active) throw error("unauthorized", 401);
    return mapUser(row);
  }

  logout(token) {
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(now(), hashToken(token || ""));
    return true;
  }

  tenant(tenantId) {
    const row = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!row) throw error("tenant_not_found", 404);
    return mapTenant(row);
  }

  settings(actor) {
    return {
      tenant: this.tenant(actor.tenant_id),
      users: this.users(actor),
      email_settings: this.emailSettings(actor),
      intake_address: this.ensureIntakeAddress(actor),
    };
  }

  updateSettings(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({
        company_name: z.string().min(1).optional(),
        logo_reference: z.string().nullable().optional(),
        address: addressSchema.optional(),
        contact_email: z.string().email().nullable().optional(),
        contact_phone: z.string().nullable().optional(),
        sales_tax_rate_basis_points: z.number().int().min(0).max(10000).optional(),
        locale: z.string().min(2).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        shop_timezone: z.string().min(1).optional(),
      })
      .parse(payload);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "address") {
        for (const [addressKey, addressValue] of Object.entries(value)) {
          const column =
            addressKey === "line1"
              ? "address_line1"
              : addressKey === "line2"
                ? "address_line2"
                : addressKey;
          fields.push(`${column} = ?`);
          values.push(addressValue ?? null);
        }
      } else {
        fields.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), actor.tenant_id);
    this.db.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    this.audit(actor, "settings.update", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Company settings updated", input);
    return this.settings(actor);
  }

  emailSettings(actor) {
    const tenant = this.tenant(actor.tenant_id);
    const row = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(actor.tenant_id);
    return mapEmailSettings(row, tenant);
  }

  updateEmailSettings(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = emailSettingsSchema.parse(payload);
    const tenant = this.tenant(actor.tenant_id);
    const existing = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(actor.tenant_id);
    const timestamp = now();
    const next = {
      sender_name: input.sender_name ?? existing?.sender_name ?? tenant.company_name,
      sender_email: input.sender_email === undefined ? existing?.sender_email ?? tenant.contact_email ?? null : input.sender_email,
      sendgrid_verified: input.sendgrid_verified === undefined ? Boolean(existing?.sendgrid_verified) : input.sendgrid_verified,
    };
    if (!next.sender_email) throw error("email_sender_required", 400);
    this.db
      .prepare(
        `INSERT INTO tenant_email_settings (tenant_id, sender_name, sender_email, sendgrid_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET
           sender_name = excluded.sender_name,
           sender_email = excluded.sender_email,
           sendgrid_verified = excluded.sendgrid_verified,
           updated_at = excluded.updated_at`,
      )
      .run(actor.tenant_id, next.sender_name, normalizedEmail(next.sender_email), bool(next.sendgrid_verified), timestamp, timestamp);
    this.audit(actor, "email_settings.update", "tenant", actor.tenant_id, tenant.portable_id, "SendGrid customer email settings updated", {
      sender_email: normalizedEmail(next.sender_email),
      sendgrid_verified: next.sendgrid_verified,
    });
    return this.emailSettings(actor);
  }

  composeIntakeAddress(slug, token) {
    const domain = normalizedEmail(process.env.SIGNGUY_SLIM_INTAKE_DOMAIN || "intake.signguy-slim.local");
    const safeSlug = String(slug || "shop").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "shop";
    const safeToken = String(token || randomUUID().replace(/-/g, "")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
    return { token: safeToken, full: `intake-${safeSlug}-${safeToken}@${domain}` };
  }

  ensureIntakeAddress(actor) {
    const existing = this.db
      .prepare("SELECT * FROM tenant_intake_addresses WHERE tenant_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1")
      .get(actor.tenant_id);
    if (existing) return mapIntakeAddress(existing);
    const tenant = this.tenant(actor.tenant_id);
    const timestamp = now();
    const intakeAddress = this.composeIntakeAddress(tenant.slug, randomUUID().replace(/-/g, ""));
    this.db
      .prepare(
        `INSERT INTO tenant_intake_addresses
         (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(randomUUID(), actor.tenant_id, intakeAddress.token, intakeAddress.full, actor.id, timestamp, timestamp);
    this.audit(actor, "intake_address.create", "tenant", actor.tenant_id, tenant.portable_id, "Incoming request address created");
    return this.ensureIntakeAddress(actor);
  }

  rotateIntakeAddress(actor, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const reason = z.object({ reason: z.string().trim().min(1).max(500) }).parse(payload).reason;
    const tenant = this.tenant(actor.tenant_id);
    const timestamp = now();
    const intakeAddress = this.composeIntakeAddress(tenant.slug, randomUUID().replace(/-/g, ""));
    this.transaction(() => {
      this.db
        .prepare("UPDATE tenant_intake_addresses SET active = 0, rotated_at = ?, rotation_reason = ?, updated_at = ? WHERE tenant_id = ? AND active = 1")
        .run(timestamp, reason, timestamp, actor.tenant_id);
      this.db
        .prepare(
          `INSERT INTO tenant_intake_addresses
           (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(randomUUID(), actor.tenant_id, intakeAddress.token, intakeAddress.full, actor.id, timestamp, timestamp);
      this.audit(actor, "intake_address.rotate", "tenant", actor.tenant_id, tenant.portable_id, "Incoming request address rotated", { reason });
    });
    return this.ensureIntakeAddress(actor);
  }

  resolveRelatedCustomer(actor, relatedEntityType, relatedEntityId) {
    if (relatedEntityType === "estimate") {
      const doc = this.estimate(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "estimate" };
    }
    if (relatedEntityType === "order") {
      const doc = this.order(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "order" };
    }
    if (relatedEntityType === "invoice") {
      const doc = this.invoice(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "invoice" };
    }
    throw error("email_related_record_invalid", 400);
  }

  async deliverEmail(payload) {
    if (this.emailTransport) return this.emailTransport(payload);
    const apiKey = process.env.SIGNGUY_SLIM_SENDGRID_API_KEY;
    if (!apiKey) throw error("email_provider_unconfigured", 503);
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.status !== 202) {
      const body = await response.text().catch(() => "");
      const err = error("email_provider_rejected", 502);
      err.provider_status = response.status;
      err.provider_body = body.slice(0, 300);
      throw err;
    }
    return { provider_message_id: response.headers.get("x-message-id") || null };
  }

  async sendCustomerEmail(actor, relatedEntityType, relatedEntityId, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = emailSendSchema.parse(payload);
    const existing = this.db
      .prepare("SELECT * FROM outbound_email_sends WHERE tenant_id = ? AND idempotency_key = ?")
      .get(actor.tenant_id, input.idempotency_key);
    if (existing) return { send: mapOutboundEmail(existing), idempotent: true };
    const { doc, customer, messageType } = this.resolveRelatedCustomer(actor, relatedEntityType, relatedEntityId);
    const settings = this.emailSettings(actor);
    if (!settings.sender_email) throw error("email_sender_required", 400);
    const toEmail = normalizedEmail(input.to_email || customer.email);
    if (!toEmail) throw error("customer_email_required", 400);
    if (customer.email && normalizedEmail(customer.email) !== toEmail && !input.confirm_unsaved_recipient) {
      throw error("email_changed_recipient_confirmation_required", 409);
    }
    const orderAttachmentIds = relatedEntityType === "order" ? this.authorizedOrderAttachmentIds(actor, relatedEntityId, input.order_attachment_ids) : [];
    const emailId = randomUUID();
    const emailPid = portable("outbound_email");
    const timestamp = now();
    const attachments = [];
    if (input.attach_document && ["estimate", "invoice"].includes(relatedEntityType)) {
      attachments.push({
        content: this.documentPdf(actor, relatedEntityType, relatedEntityId).toString("base64"),
        filename: `${relatedEntityType}-${doc[`${relatedEntityType}_number`] || relatedEntityId}.pdf`,
        type: "application/pdf",
        disposition: "attachment",
      });
    }
    const providerPayload = {
      personalizations: [{ to: [{ email: toEmail }], cc: input.cc.map((email) => ({ email: normalizedEmail(email) })) }],
      from: { email: settings.sender_email, name: settings.sender_name || this.tenant(actor.tenant_id).company_name },
      subject: input.subject,
      content: [{ type: "text/plain", value: input.body_text }],
      attachments,
      custom_args: { tenant_id: actor.tenant_id, outbound_email_send_id: emailId, related_entity_type: relatedEntityType, related_entity_id: relatedEntityId },
    };
    try {
      const delivered = await this.deliverEmail(providerPayload);
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO outbound_email_sends
             (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
              sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, provider_message_id, delivery_state,
              document_attached, order_attachment_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
          )
          .run(emailId, emailPid, actor.tenant_id, input.idempotency_key, customer.id, relatedEntityType, relatedEntityId, messageType, actor.id, settings.sender_email, settings.sender_name || this.tenant(actor.tenant_id).company_name, toEmail, JSON.stringify(input.cc.map(normalizedEmail)), input.subject, input.body_text, delivered.provider_message_id || emailId, bool(input.attach_document), JSON.stringify(orderAttachmentIds), timestamp, timestamp);
        this.insertCommunication(actor, {
          customer_id: customer.id,
          direction: "outbound",
          channel: "email",
          activity_type: "app_sent_email",
          sender_email: settings.sender_email,
          recipient_emails: [toEmail, ...input.cc.map(normalizedEmail)],
          subject: input.subject,
          body_text: input.body_text,
          summary: `${relatedEntityType[0].toUpperCase() + relatedEntityType.slice(1)} email sent to ${toEmail}`,
          related_entity_type: relatedEntityType,
          related_entity_id: relatedEntityId,
          outbound_email_send_id: emailId,
          delivery_state: "sent",
        });
        if (relatedEntityType === "estimate" && doc.status === "draft") {
          this.db.prepare("UPDATE estimates SET status = 'sent', updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, relatedEntityId, actor.tenant_id);
        }
        if (relatedEntityType === "invoice" && doc.document_status === "draft") {
          this.db.prepare("UPDATE invoices SET document_status = 'issued', updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, relatedEntityId, actor.tenant_id);
        }
        this.audit(actor, "email.send", relatedEntityType, relatedEntityId, doc.portable_id, `${relatedEntityType} email accepted by SendGrid`, { outbound_email_send_id: emailId, to_email: toEmail, delivery_state: "sent" });
      });
      return { send: mapOutboundEmail(this.db.prepare("SELECT * FROM outbound_email_sends WHERE id = ? AND tenant_id = ?").get(emailId, actor.tenant_id)), idempotent: false };
    } catch (err) {
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO outbound_email_sends
             (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
              sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, delivery_state, failure_reason,
              document_attached, order_attachment_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?)`,
          )
          .run(emailId, emailPid, actor.tenant_id, input.idempotency_key, customer.id, relatedEntityType, relatedEntityId, messageType, actor.id, settings.sender_email, settings.sender_name || this.tenant(actor.tenant_id).company_name, toEmail, JSON.stringify(input.cc.map(normalizedEmail)), input.subject, input.body_text, err.message, bool(input.attach_document), JSON.stringify(orderAttachmentIds), timestamp, timestamp);
        this.audit(actor, "email.failed", relatedEntityType, relatedEntityId, doc.portable_id, `${relatedEntityType} email failed before provider acceptance`, { outbound_email_send_id: emailId, error: err.message });
      });
      throw err;
    }
  }

  authorizedOrderAttachmentIds(actor, orderId, ids = []) {
    return ids.map((id) => this.attachmentRecord(actor, orderId, id).id);
  }

  insertCommunication(actor, entry) {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO customer_communications
         (id, portable_id, tenant_id, customer_id, direction, channel, activity_type, author_user_id, sender_email,
          recipient_emails_json, subject, body_text, summary, related_entity_type, related_entity_id,
          outbound_email_send_id, intake_item_id, delivery_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, portable("communication"), actor.tenant_id, entry.customer_id, entry.direction, entry.channel, entry.activity_type, actor.id, entry.sender_email ?? null, JSON.stringify(entry.recipient_emails || []), entry.subject ?? null, entry.body_text ?? null, entry.summary, entry.related_entity_type ?? "customer", entry.related_entity_id ?? entry.customer_id, entry.outbound_email_send_id ?? null, entry.intake_item_id ?? null, entry.delivery_state ?? null, timestamp);
    return mapCommunication(this.db.prepare("SELECT * FROM customer_communications WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
  }

  createManualCommunication(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = manualCommunicationSchema.parse(payload);
    this.customer(actor, input.customer_id);
    if (input.related_entity_type && input.related_entity_type !== "customer" && input.related_entity_id) {
      this.resolveCommunicationLink(actor, input.related_entity_type, input.related_entity_id, input.customer_id);
    }
    const communication = this.insertCommunication(actor, {
      ...input,
      activity_type: "manual_note",
      sender_email: input.direction === "outbound" ? actor.email : null,
      recipient_emails: [],
      summary: input.subject || `${input.channel.replace("_", " ")} communication note`,
      related_entity_type: input.related_entity_type || "customer",
      related_entity_id: input.related_entity_id || input.customer_id,
    });
    this.audit(actor, "communication_note.create", "customer", input.customer_id, this.customer(actor, input.customer_id).portable_id, "Customer communication note added", {
      communication_id: communication.id,
      channel: input.channel,
      direction: input.direction,
    });
    return communication;
  }

  resolveCommunicationLink(actor, type, id, customerId) {
    if (type === "estimate" && this.estimate(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "order" && this.order(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "invoice" && this.invoice(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "order_intake") this.intakeItem(actor, id);
  }

  listCommunications(actor, filters = {}) {
    const params = [actor.tenant_id];
    const where = ["tenant_id = ?"];
    if (filters.customer_id) {
      this.customer(actor, filters.customer_id);
      where.push("customer_id = ?");
      params.push(filters.customer_id);
    }
    if (filters.related_entity_type && filters.related_entity_id) {
      where.push("related_entity_type = ? AND related_entity_id = ?");
      params.push(filters.related_entity_type, filters.related_entity_id);
    }
    return this.db
      .prepare(`SELECT * FROM customer_communications WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params)
      .map(mapCommunication);
  }

  verifyWebhookSignature(kind, payload, signature) {
    const production = process.env.NODE_ENV === "production";
    if (kind === "sendgrid_events") {
      return verifySharedSecretSignature({
        secret: process.env.SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET,
        payload,
        signature,
        required: production,
        errorCode: "email_webhook_signature_invalid",
      });
    }
    return verifySharedSecretSignature({
      secret: process.env.SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET,
      payload,
      signature,
      required: production,
      errorCode: "intake_webhook_signature_invalid",
    });
  }

  processSendGridEvents(payload, { signature = "" } = {}) {
    const raw = JSON.stringify(payload ?? []);
    this.verifyWebhookSignature("sendgrid_events", raw, signature);
    const events = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const eventPayload of events) {
      const providerId = String(eventPayload.sg_event_id || eventPayload.event_id || `${eventPayload.sg_message_id || eventPayload.outbound_email_send_id}-${eventPayload.event}-${eventPayload.timestamp}`);
      const send = this.db
        .prepare(
          `SELECT * FROM outbound_email_sends
           WHERE id = ? OR provider_message_id = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(eventPayload.outbound_email_send_id || eventPayload.outbound_email_send_id === 0 ? String(eventPayload.outbound_email_send_id) : null, eventPayload.sg_message_id || eventPayload.provider_message_id || null);
      if (!send) {
        results.push({ provider_event_id: providerId, status: "unmatched" });
        continue;
      }
      const existing = this.db.prepare("SELECT id FROM sendgrid_events WHERE tenant_id = ? AND provider_event_id = ?").get(send.tenant_id, providerId);
      if (existing) {
        results.push({ provider_event_id: providerId, status: "duplicate" });
        continue;
      }
      const eventType = String(eventPayload.event || "processed").replace(/-/g, "_");
      const state = this.deliveryStateForEvent(eventType);
      const timestamp = now();
      const occurred = eventPayload.timestamp ? new Date(Number(eventPayload.timestamp) * 1000).toISOString() : timestamp;
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO sendgrid_events
             (id, tenant_id, outbound_email_send_id, provider_event_id, event_type, occurred_at, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), send.tenant_id, send.id, providerId, eventType, occurred, JSON.stringify({ event: eventType, email: eventPayload.email || null, reason: eventPayload.reason || eventPayload.response || null }), timestamp);
        if (state) {
          this.db
            .prepare("UPDATE outbound_email_sends SET delivery_state = ?, failure_reason = COALESCE(?, failure_reason), updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(state, eventPayload.reason || eventPayload.response || null, timestamp, send.id, send.tenant_id);
          this.db
            .prepare("UPDATE customer_communications SET delivery_state = ? WHERE outbound_email_send_id = ? AND tenant_id = ?")
            .run(state, send.id, send.tenant_id);
        }
        this.auditSystem(send.tenant_id, "email.delivery_event", send.related_entity_type, send.related_entity_id, send.portable_id, `SendGrid ${eventType} event recorded`, { outbound_email_send_id: send.id, delivery_state: state || send.delivery_state });
      });
      results.push({ provider_event_id: providerId, status: "recorded", delivery_state: state || send.delivery_state });
    }
    return { processed: results };
  }

  deliveryStateForEvent(eventType) {
    const normalized = String(eventType || "").replace(/-/g, "_");
    if (normalized === "delivered") return "delivered";
    if (normalized === "deferred") return "deferred";
    if (normalized === "bounce" || normalized === "bounced") return "bounced";
    if (normalized === "dropped") return "dropped";
    if (normalized === "blocked") return "blocked";
    if (normalized === "spamreport" || normalized === "spam_report") return "spam_report";
    if (normalized === "open" || normalized === "opened") return "opened";
    if (normalized === "click" || normalized === "clicked") return "clicked";
    return null;
  }

  receiveEmailIntake(payload, { signature = "" } = {}) {
    const raw = JSON.stringify(payload ?? {});
    this.verifyWebhookSignature("intake_email", raw, signature);
    const input = inboundIntakeSchema.parse(payload);
    const address = this.db
      .prepare("SELECT * FROM tenant_intake_addresses WHERE full_address = ? AND active = 1")
      .get(normalizedEmail(input.intake_address));
    if (!address) throw error("intake_address_not_found", 404);
    const existing = this.db
      .prepare("SELECT oi.id FROM order_intake_items oi JOIN intake_source_messages ism ON ism.id = oi.source_message_id AND ism.tenant_id = oi.tenant_id WHERE oi.tenant_id = ? AND ism.provider_message_id = ?")
      .get(address.tenant_id, input.provider_message_id);
    if (existing) return { item: this.intakeItemByTenant(address.tenant_id, existing.id), idempotent: true };
    const sourceId = randomUUID();
    const itemId = randomUUID();
    const timestamp = now();
    const receivedAt = input.received_at ? new Date(input.received_at).toISOString() : timestamp;
    const payloadHash = createHash("sha256").update(raw).digest("hex");
    const storedPaths = [];
    const attachments = input.attachments.map((attachment) => {
      const extension = fileExtension(attachment.original_filename);
      let accepted = ALLOWED_ATTACHMENT_MIME_TYPES.has(attachment.mime_type) && MIME_EXTENSIONS[attachment.mime_type]?.has(extension) && attachment.byte_size <= uploadLimitBytes();
      let rejectionReason = accepted ? null : "unsupported_or_too_large";
      let storageKey = null;
      let sha256 = attachment.sha256 ?? null;
      if (accepted && attachment.content_base64) {
        try {
          const bytes = Buffer.from(attachment.content_base64, "base64");
          if (bytes.length !== attachment.byte_size) throw error("attachment_integrity_mismatch", 409);
          const actualSha = createHash("sha256").update(bytes).digest("hex");
          if (sha256 && sha256.toLowerCase() !== actualSha) throw error("attachment_integrity_mismatch", 409);
          sha256 = actualSha;
          storageKey = join(address.tenant_id, "intake", sourceId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
          const path = this.attachmentPath(storageKey);
          writeFileSync(path, bytes);
          verifyAttachmentContent(path, attachment.mime_type);
          storedPaths.push(path);
        } catch {
          if (storageKey) rmSync(this.attachmentPath(storageKey), { force: true });
          accepted = false;
          rejectionReason = "content_validation_failed";
          storageKey = null;
        }
      }
      return { ...attachment, sha256, storage_key: storageKey, accepted, rejection_reason: rejectionReason };
    });
    try {
      this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO intake_source_messages
           (id, portable_id, tenant_id, provider_message_id, intake_address, sender_name, sender_email, recipients_json,
            subject, sent_at, received_at, text_body, html_body, sanitized_html, payload_hash, receipt_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
        )
        .run(sourceId, portable("intake_source_message"), address.tenant_id, input.provider_message_id, normalizedEmail(input.intake_address), input.sender_name ?? null, normalizedEmail(input.sender_email), JSON.stringify(input.recipients.map(normalizedEmail)), input.subject || "(no subject)", input.sent_at ? new Date(input.sent_at).toISOString() : null, receivedAt, input.text_body ?? null, input.html_body ?? null, sanitizeHtmlFragment(input.html_body ?? ""), payloadHash, timestamp);
      this.db
        .prepare(
          `INSERT INTO order_intake_items
           (id, portable_id, tenant_id, source_message_id, status, summary, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'new', ?, ?, ?)`,
        )
        .run(itemId, portable("order_intake_item"), address.tenant_id, sourceId, input.subject || "Forwarded order email", timestamp, timestamp);
      for (const attachment of attachments) {
        this.db
          .prepare(
            `INSERT INTO intake_attachments
             (id, tenant_id, source_message_id, original_filename, storage_key, mime_type, byte_size, sha256, accepted, rejection_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), address.tenant_id, sourceId, safeFilename(attachment.original_filename), attachment.storage_key, attachment.mime_type, attachment.byte_size, attachment.sha256 ?? null, bool(attachment.accepted), attachment.rejection_reason, timestamp);
      }
      this.auditSystem(address.tenant_id, "intake.email_received", "order_intake", itemId, itemId, "Forwarded email received into Incoming Requests", { provider_message_id: input.provider_message_id, attachment_count: attachments.length });
      });
    } catch (err) {
      for (const path of storedPaths) rmSync(path, { force: true });
      throw err;
    }
    return { item: this.intakeItemByTenant(address.tenant_id, itemId), idempotent: false };
  }

  intakeRows(actor, filters = {}) {
    const params = [actor.tenant_id];
    const where = ["oi.tenant_id = ?"];
    if (filters.status && filters.status !== "all") {
      where.push("oi.status = ?");
      params.push(filters.status);
    }
    if (filters.assigned_user_id) {
      where.push("oi.assigned_user_id = ?");
      params.push(filters.assigned_user_id);
    }
    if (filters.customer_id) {
      where.push("oi.customer_id = ?");
      params.push(filters.customer_id);
    }
    if (filters.search) {
      where.push("(oi.summary LIKE ? OR ism.sender_email LIKE ? OR ism.subject LIKE ?)");
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }
    return this.db
      .prepare(
        `SELECT oi.*, ism.sender_email, ism.sender_name, ism.subject, ism.received_at,
                c.contact_name AS customer_contact_name, c.business_name AS customer_business_name, c.email AS customer_email,
                u.display_name AS assignee_name,
                co.order_number AS converted_order_number, lo.order_number AS linked_order_number
         FROM order_intake_items oi
         JOIN intake_source_messages ism ON ism.id = oi.source_message_id AND ism.tenant_id = oi.tenant_id
         LEFT JOIN customers c ON c.id = oi.customer_id AND c.tenant_id = oi.tenant_id
         LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
         LEFT JOIN orders co ON co.id = oi.converted_order_id AND co.tenant_id = oi.tenant_id
         LEFT JOIN orders lo ON lo.id = oi.linked_order_id AND lo.tenant_id = oi.tenant_id
         WHERE ${where.join(" AND ")}
         ORDER BY ism.received_at DESC`,
      )
      .all(...params);
  }

  listIntakeItems(actor, filters = {}) {
    return this.intakeRows(actor, filters).map((row) => mapIntakeItem(row));
  }

  intakeItem(actor, id) {
    return this.intakeItemByTenant(actor.tenant_id, id);
  }

  intakeItemByTenant(tenantId, id) {
    const row = this.db
      .prepare(
        `SELECT oi.*,
                c.contact_name AS customer_contact_name, c.business_name AS customer_business_name, c.email AS customer_email,
                u.display_name AS assignee_name,
                co.order_number AS converted_order_number, lo.order_number AS linked_order_number
         FROM order_intake_items oi
         LEFT JOIN customers c ON c.id = oi.customer_id AND c.tenant_id = oi.tenant_id
         LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
         LEFT JOIN orders co ON co.id = oi.converted_order_id AND co.tenant_id = oi.tenant_id
         LEFT JOIN orders lo ON lo.id = oi.linked_order_id AND lo.tenant_id = oi.tenant_id
         WHERE oi.id = ? AND oi.tenant_id = ?`,
      )
      .get(id, tenantId);
    if (!row) throw error("intake_item_not_found", 404);
    const source = mapIntakeMessage(this.db.prepare("SELECT * FROM intake_source_messages WHERE id = ? AND tenant_id = ?").get(row.source_message_id, tenantId));
    const attachments = this.db.prepare("SELECT * FROM intake_attachments WHERE source_message_id = ? AND tenant_id = ? ORDER BY created_at").all(row.source_message_id, tenantId).map(mapIntakeAttachment);
    return mapIntakeItem(row, source, attachments);
  }

  updateIntakeItem(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = intakeUpdateSchema.parse(payload);
    const existing = this.intakeItem(actor, id);
    if (!Object.keys(input).length) throw error("no_updates");
    if (input.customer_id) this.customer(actor, input.customer_id);
    if (input.assigned_user_id) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(input.assigned_user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
    }
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE order_intake_items SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    this.audit(actor, "intake.update", "order_intake", id, existing.portable_id, "Incoming request updated", input);
    return this.intakeItem(actor, id);
  }

  createCustomerFromIntake(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const item = this.intakeItem(actor, id);
    const input = intakeCustomerSchema.parse(payload);
    const source = item.source_message;
    const customer = this.createCustomer(actor, {
      contact_name: input.contact_name,
      business_name: input.business_name ?? null,
      email: input.email ?? source.sender_email,
      phone: input.phone ?? null,
      billing_address: input.billing_address ?? { line1: "Address pending", line2: null, city: "Pending", state: "NA", postal_code: "00000", country: "US" },
      active: true,
      tax_exempt: false,
      internal_notes: `Created from incoming request ${item.summary}`,
    });
    return this.updateIntakeItem(actor, id, { customer_id: customer.id, status: "reviewing" });
  }

  createDraftOrderFromIntake(actor, id, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const item = this.intakeItem(actor, id);
      if (item.converted_order_id) return { order: this.order(actor, item.converted_order_id), item, idempotent: true };
      if (item.linked_order_id) throw error("intake_already_linked", 409);
      const customerId = payload.customer_id || item.customer_id;
      if (!customerId) throw error("intake_customer_required", 400);
      this.customer(actor, customerId);
      const source = item.source_message;
      const order = this.createOrderInternal(actor, {
        customer_id: customerId,
        title: payload.title || source.subject || item.summary,
        document_date: today(),
        due_date: payload.due_date ?? item.follow_up_at ?? null,
        status: "draft",
        discount_cents: 0,
        internal_notes: `Draft created from incoming request ${item.summary}. Original forwarded email preserved on incoming request ${item.id}.`,
        items: [{
          title: "Intake Review",
          description: source.text_body?.slice(0, 500) || source.subject || "Review forwarded email for order details.",
          quantity_decimal: "1",
          unit_price_cents: 0,
          line_total_cents: 0,
          taxable: false,
          production_required: false,
        }],
      });
      const timestamp = now();
      this.db
        .prepare("UPDATE order_intake_items SET converted_order_id = ?, converted_by_user_id = ?, converted_at = ?, status = 'converted_to_order', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(order.id, actor.id, timestamp, timestamp, id, actor.tenant_id);
      this.copyIntakeAttachmentsToOrder(actor, item, order.id);
      this.audit(actor, "intake.convert_to_order", "order_intake", id, item.portable_id, `Incoming request converted to ${order.order_number}`, { order_id: order.id });
      return { order, item: this.intakeItem(actor, id), idempotent: false };
    });
  }

  linkIntakeToOrder(actor, id, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    const orderId = z.object({ order_id: z.string().min(1) }).parse(payload).order_id;
    return this.transaction(() => {
      const item = this.intakeItem(actor, id);
      if (item.converted_order_id) throw error("intake_already_converted", 409);
      const order = this.order(actor, orderId);
      const timestamp = now();
      this.db
        .prepare("UPDATE order_intake_items SET linked_order_id = ?, customer_id = COALESCE(customer_id, ?), converted_by_user_id = ?, converted_at = ?, status = 'attached_to_existing_order', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(order.id, order.customer_id, actor.id, timestamp, timestamp, id, actor.tenant_id);
      this.copyIntakeAttachmentsToOrder(actor, item, order.id);
      this.audit(actor, "intake.link_order", "order_intake", id, item.portable_id, `Incoming request linked to ${order.order_number}`, { order_id: order.id });
      return { order, item: this.intakeItem(actor, id) };
    });
  }

  copyIntakeAttachmentsToOrder(actor, intakeItem, orderId) {
    const order = this.order(actor, orderId);
    const rows = this.db
      .prepare("SELECT * FROM intake_attachments WHERE tenant_id = ? AND source_message_id = ? AND accepted = 1 AND storage_key IS NOT NULL AND order_attachment_id IS NULL")
      .all(actor.tenant_id, intakeItem.source_message_id);
    const copiedPaths = [];
    try {
      for (const row of rows) {
        const sourcePath = this.attachmentPath(row.storage_key);
        if (!existsSync(sourcePath)) throw error("attachment_file_missing", 404);
        const stat = statSync(sourcePath);
        if (!stat.isFile() || stat.size !== row.byte_size) throw error("attachment_integrity_mismatch", 409);
        const sha256 = fileSha256(sourcePath);
        if (row.sha256 && row.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
        const storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${fileExtension(row.original_filename)}`).replace(/\\/g, "/");
        const targetPath = this.attachmentPath(storageKey);
        copyFileSync(sourcePath, targetPath);
        verifyAttachmentContent(targetPath, row.mime_type);
        const dimensions = imageDimensions(targetPath, row.mime_type);
        copiedPaths.push(targetPath);
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at, source_type, image_width, image_height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?)`,
          )
          .run(id, portable("order_attachment"), actor.tenant_id, orderId, row.original_filename, storageKey, row.mime_type, row.byte_size, sha256, actor.id, timestamp, dimensions.width, dimensions.height);
        this.db.prepare("UPDATE intake_attachments SET order_attachment_id = ? WHERE id = ? AND tenant_id = ?").run(id, row.id, actor.tenant_id);
        this.audit(actor, "intake.attachment_carried", "order", orderId, order.portable_id, `Intake attachment ${row.original_filename} carried into Order`, { intake_item_id: intakeItem.id, attachment_id: id });
      }
      return rows.length;
    } catch (err) {
      for (const path of copiedPaths) rmSync(path, { force: true });
      throw err;
    }
  }

  users(actor) {
    return this.db.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY display_name").all(actor.tenant_id).map(mapUser);
  }

  async addUser(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({
        display_name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        role: z.enum(ROLES),
        active: z.boolean().default(true),
      })
      .parse(payload);
    if (input.role === "owner" && actor.role !== "owner") throw error("owner_role_requires_owner", 403);
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO users (id, portable_id, tenant_id, display_name, email, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, portable("user"), actor.tenant_id, input.display_name, input.email.toLowerCase(), await hashPassword(input.password), input.role, bool(input.active), timestamp, timestamp);
    const user = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    this.audit(actor, "user.create", "user", user.id, user.portable_id, `User ${user.display_name} created`, { role: user.role });
    return user;
  }

  updateUser(actor, id, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!existing) throw error("user_not_found", 404);
    if (existing.role === "owner" && actor.role !== "owner") throw error("owner_role_locked", 403);
    const input = z
      .object({
        display_name: z.string().min(1).optional(),
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
      })
      .parse(payload);
    if (input.role === "owner" && actor.role !== "owner") throw error("owner_role_requires_owner", 403);
    const nextRole = input.role ?? existing.role;
    const nextActive = input.active ?? Boolean(existing.active);
    if (existing.role === "owner" && (!nextActive || nextRole !== "owner") && this.activeOwnerCount(actor.tenant_id) <= 1) {
      throw error("last_active_owner_required", 403);
    }
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "boolean" ? bool(value) : value);
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    if (input.active === false) {
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND tenant_id = ? AND revoked_at IS NULL").run(now(), id, actor.tenant_id);
    }
    const user = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    this.audit(actor, "user.update", "user", user.id, user.portable_id, `User ${user.display_name} updated`, input);
    return user;
  }

  activeOwnerCount(tenantId) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND role = 'owner' AND active = 1").get(tenantId).count;
  }

  tenantTimezone(actor) {
    return this.tenant(actor.tenant_id).shop_timezone || "America/New_York";
  }

  nextEmployeeNumber(tenantId) {
    const next = this.db.prepare("SELECT next_value FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = 'employee'").get(tenantId)?.next_value || 1;
    this.db.prepare(
      `INSERT INTO tenant_sequences (tenant_id, sequence_name, next_value)
       VALUES (?, 'employee', ?)
       ON CONFLICT(tenant_id, sequence_name) DO UPDATE SET next_value = excluded.next_value`,
    ).run(tenantId, next + 1);
    return `EMP-${String(next).padStart(4, "0")}`;
  }

  currentRateRow(employeeId, tenantId, effectiveDate = today()) {
    return this.db
      .prepare(
        `SELECT * FROM employee_rates
         WHERE tenant_id = ? AND employee_id = ? AND effective_date <= ?
         ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      )
      .get(tenantId, employeeId, effectiveDate);
  }

  employeeRecord(actor, employeeId, { includeInactive = true, includePay = false } = {}) {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE id = ? AND tenant_id = ?")
      .get(employeeId, actor.tenant_id);
    if (!row || (!includeInactive && !row.active)) throw error("employee_not_found", 404);
    if (!includePay) return row;
    const rate = this.currentRateRow(row.id, actor.tenant_id, today());
    return { ...row, current_rate_cents: rate?.hourly_rate_cents ?? null, current_rate_effective_date: rate?.effective_date ?? null };
  }

  activeEmployeeForActor(actor) {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1")
      .get(actor.tenant_id, actor.id);
    if (!row) throw error("employee_inactive", 403);
    if (!row.portal_access_enabled) throw error("employee_portal_disabled", 403);
    return row;
  }

  employeePortalRecordForActor(actor) {
    if (!actor?.active) return null;
    return this.db
      .prepare(
        `SELECT e.id
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, actor.id) || null;
  }

  activeEmployeeForUser(actor, userId) {
    const row = this.db
      .prepare(
        `SELECT e.*, u.display_name, u.email AS user_email, u.role AS user_role
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, userId);
    if (!row) throw error("message_recipient_invalid", 400);
    return row;
  }

  canManagePay(actor) {
    if (actor?.role === "owner") return true;
    const row = this.db
      .prepare("SELECT pay_management_enabled FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 AND portal_access_enabled = 1 LIMIT 1")
      .get(actor.tenant_id, actor.id);
    return Boolean(row?.pay_management_enabled);
  }

  requirePayManagement(actor) {
    if (!actor?.active || !this.canManagePay(actor)) throw error("pay_permission_required", 403);
  }

  capabilitiesForActor(actor) {
    const active = Boolean(actor?.active);
    return {
      can_manage_employees: active && MANAGER_ROLES.has(actor.role),
      can_review_time: active && MANAGER_ROLES.has(actor.role),
      can_manage_pay: active && this.canManagePay(actor),
      can_use_employee_portal: Boolean(this.employeePortalRecordForActor(actor)),
      can_manage_announcements: active && ADMIN_ROLES.has(actor.role),
    };
  }

  listEmployees(actor) {
    this.requireRole(actor, MANAGER_ROLES);
    const includePay = this.canManagePay(actor);
    return this.db
      .prepare(
        `SELECT e.*,
                (SELECT hourly_rate_cents FROM employee_rates r WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.effective_date <= ? ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS current_rate_cents,
                (SELECT effective_date FROM employee_rates r WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.effective_date <= ? ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS current_rate_effective_date
         FROM employees e WHERE e.tenant_id = ? ORDER BY e.active DESC, e.name, e.id`,
      )
      .all(today(), today(), actor.tenant_id)
      .map((row) => mapEmployee(row, { includePay }));
  }

  createEmployee(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = employeeSchema.parse(payload);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(input.user_id, actor.tenant_id);
    if (!user) throw error("employee_user_tenant_mismatch", 400);
    const duplicate = this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1").get(actor.tenant_id, input.user_id);
    if (duplicate && input.active !== false) throw error("employee_user_already_linked", 409);
    if (input.pay_management_enabled && actor.role !== "owner") throw error("pay_permission_required", 403);
    const id = randomUUID();
    const timestamp = now();
    return this.transaction(() => {
      const employeeNumber = this.nextEmployeeNumber(actor.tenant_id);
      this.db.prepare(
        `INSERT INTO employees
         (id, portable_id, tenant_id, user_id, employee_number, name, email, phone, role, portal_access_enabled, pay_management_enabled, active, hire_date, internal_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        portable("employee"),
        actor.tenant_id,
        input.user_id,
        employeeNumber,
        input.name,
        normalizedEmail(input.email),
        input.phone ?? null,
        input.role,
        bool(input.portal_access_enabled),
        bool(input.pay_management_enabled),
        bool(input.active),
        input.hire_date ?? null,
        input.internal_note ?? null,
        timestamp,
        timestamp,
      );
      if (input.hourly_rate_cents !== undefined) {
        this.addEmployeeRate(actor, id, {
          hourly_rate_cents: input.hourly_rate_cents,
          effective_date: input.rate_effective_date || input.hire_date || today(),
          note: "Initial employee rate",
        });
      }
      const employee = this.employeeRecord(actor, id, { includePay: true });
      this.audit(actor, "employee.create", "employee", id, employee.portable_id, `Employee ${employee.name} created`, { user_id: input.user_id, active: input.active });
      return mapEmployee(employee, { includePay: true });
    });
  }

  updateEmployee(actor, employeeId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.employeeRecord(actor, employeeId);
    const input = employeeUpdateSchema.parse(payload);
    if (input.pay_management_enabled !== undefined && actor.role !== "owner") throw error("pay_permission_required", 403);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "boolean" ? bool(value) : key === "email" ? normalizedEmail(value) : value);
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), employeeId, actor.tenant_id);
    this.db.prepare(`UPDATE employees SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    const updated = this.employeeRecord(actor, employeeId, { includePay: true });
    this.audit(actor, "employee.update", "employee", employeeId, updated.portable_id, `Employee ${updated.name} updated`, { before: { active: Boolean(existing.active), portal_access_enabled: Boolean(existing.portal_access_enabled) }, after: input });
    return mapEmployee(updated, { includePay: this.canManagePay(actor) });
  }

  addEmployeeRate(actor, employeeId, payload) {
    this.requirePayManagement(actor);
    const employee = this.employeeRecord(actor, employeeId);
    const input = employeeRateSchema.parse(payload);
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_rates (id, tenant_id, employee_id, effective_date, hourly_rate_cents, note, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, actor.tenant_id, employeeId, input.effective_date, input.hourly_rate_cents, input.note ?? null, actor.id, timestamp);
    this.audit(actor, "employee.rate_create", "employee", employeeId, employee.portable_id, `Employee rate effective ${input.effective_date}`, { hourly_rate_cents: input.hourly_rate_cents, effective_date: input.effective_date });
    return this.employeeRates(actor, employeeId);
  }

  employeeRates(actor, employeeId) {
    this.requirePayManagement(actor);
    this.employeeRecord(actor, employeeId);
    return this.db.prepare("SELECT * FROM employee_rates WHERE tenant_id = ? AND employee_id = ? ORDER BY effective_date DESC, created_at DESC").all(actor.tenant_id, employeeId);
  }

  rateForInstant(actor, employeeId, instant) {
    const effectiveDate = localDateForInstant(instant, this.tenantTimezone(actor));
    const rate = this.currentRateRow(employeeId, actor.tenant_id, effectiveDate);
    if (!rate) throw error("employee_rate_missing", 400);
    return rate;
  }

  ensurePayWeek(actor, employeeId, weekStart, openingCarryover = null) {
    const normalizedStart = payWeekStart(weekStart);
    const existing = this.db.prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date = ?").get(actor.tenant_id, employeeId, normalizedStart);
    if (existing) return existing;
    const previous = this.db
      .prepare(
        `SELECT * FROM employee_pay_weeks
         WHERE tenant_id = ? AND employee_id = ? AND week_start_date < ? AND status = 'closed'
         ORDER BY week_start_date DESC LIMIT 1`,
      )
      .get(actor.tenant_id, employeeId, normalizedStart);
    const carryover = openingCarryover ?? previous?.closing_carryover_cents ?? 0;
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_pay_weeks
       (id, tenant_id, employee_id, week_start_date, week_end_date, payday_date, status, opening_carryover_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(randomUUID(), actor.tenant_id, employeeId, normalizedStart, payWeekEnd(normalizedStart), payWeekEnd(normalizedStart), carryover, timestamp, timestamp);
    return this.db.prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date = ?").get(actor.tenant_id, employeeId, normalizedStart);
  }

  payWeekCalculation(actor, employeeId, weekStart, openingCarryover) {
    const normalizedStart = payWeekStart(weekStart);
    const timezone = this.tenantTimezone(actor);
    const weekEnd = payWeekEnd(normalizedStart);
    const startUtc = parseShopDateTime(`${normalizedStart}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(weekEnd, 1)}T00:00:00`, timezone);
    const entries = this.db
      .prepare(
        `SELECT * FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status = 'closed' AND clock_in_at < ? AND clock_out_at > ?
         ORDER BY clock_in_at, id`,
      )
      .all(actor.tenant_id, employeeId, endUtc, startUtc);
    const breakdownMap = new Map();
    const entryIds = [];
    for (const entry of entries) {
      const minutes = overlappedMinutes(entry, startUtc, endUtc);
      if (!minutes) continue;
      const key = String(entry.rate_cents_snapshot);
      const current = breakdownMap.get(key) || { hourly_rate_cents: entry.rate_cents_snapshot, minutes: 0, gross_pay_cents: 0 };
      current.minutes += minutes;
      current.gross_pay_cents += grossCentsForMinutes(minutes, entry.rate_cents_snapshot);
      breakdownMap.set(key, current);
      entryIds.push(entry.id);
    }
    const validMinutes = [...breakdownMap.values()].reduce((sum, entry) => sum + entry.minutes, 0);
    const gross = [...breakdownMap.values()].reduce((sum, entry) => sum + entry.gross_pay_cents, 0);
    const advances = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_advances WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const positive = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND direction = 'positive' AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const negative = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND direction = 'negative' AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const manual = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_manual_payments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const due = openingCarryover + gross + positive - negative - advances - manual;
    return {
      week_start_date: normalizedStart,
      week_end_date: weekEnd,
      payday_date: weekEnd,
      valid_minutes: validMinutes,
      gross_pay_cents: gross,
      positive_adjustments_cents: positive,
      negative_adjustments_cents: negative,
      advances_cents: advances,
      manual_payments_cents: manual,
      estimated_amount_due_cents: due,
      rate_breakdown: [...breakdownMap.values()].map((entry) => ({ ...entry, hours_decimal: (entry.minutes / 60).toFixed(2) })),
      entry_ids: entryIds,
    };
  }

  requireOpenPayWeeksForInterval(actor, employeeId, clockInAt, clockOutAt, timezone) {
    for (const weekStart of payWeekStartsForInterval(clockInAt, clockOutAt, timezone)) {
      this.requireOpenPayWeek(actor, employeeId, weekStart);
    }
  }

  requireNoOpenTimeEntryInPayWeek(actor, employeeId, week, timezone) {
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const current = now();
    const open = this.db
      .prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status = 'open' AND clock_in_at < ? AND ? > ?
         LIMIT 1`,
      )
      .get(actor.tenant_id, employeeId, endUtc, current, startUtc);
    if (open) throw error("pay_week_has_open_time_entry", 409);
  }

  refreshOpenPayWeek(actor, employeeId, weekStart) {
    const week = this.ensurePayWeek(actor, employeeId, weekStart);
    if (week.status === "closed") return week;
    const calc = this.payWeekCalculation(actor, employeeId, week.week_start_date, week.opening_carryover_cents);
    this.db.prepare(
      `UPDATE employee_pay_weeks SET valid_minutes = ?, gross_pay_cents = ?, positive_adjustments_cents = ?, negative_adjustments_cents = ?,
       advances_cents = ?, manual_payments_cents = ?, estimated_amount_due_cents = ?, rate_breakdown_json = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
    ).run(calc.valid_minutes, calc.gross_pay_cents, calc.positive_adjustments_cents, calc.negative_adjustments_cents, calc.advances_cents, calc.manual_payments_cents, calc.estimated_amount_due_cents, JSON.stringify(calc.rate_breakdown), now(), week.id, actor.tenant_id);
    return this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id);
  }

  requireOpenPayWeek(actor, employeeId, weekStart) {
    const week = this.ensurePayWeek(actor, employeeId, weekStart);
    if (week.status === "closed") throw error("pay_week_closed", 409);
    return week;
  }

  updateOpenCarryoverChain(actor, employeeId, fromWeekStart, openingCarryover) {
    let carry = openingCarryover;
    const weeks = this.db
      .prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date >= ? ORDER BY week_start_date")
      .all(actor.tenant_id, employeeId, fromWeekStart);
    for (const week of weeks) {
      if (week.status === "closed") throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.db.prepare("UPDATE employee_pay_weeks SET opening_carryover_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(carry, now(), week.id, actor.tenant_id);
      const refreshed = this.refreshOpenPayWeek(actor, employeeId, week.week_start_date);
      carry = refreshed.estimated_amount_due_cents;
    }
  }

  propagateFollowingOpenWeeks(actor, employeeId, weekStart) {
    const current = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    if (current.status === "closed") return current;
    const nextStart = addDays(current.week_end_date, 1);
    this.updateOpenCarryoverChain(actor, employeeId, nextStart, current.estimated_amount_due_cents);
    return current;
  }

  currentTimeClock(actor) {
    const employee = this.activeEmployeeForActor(actor);
    return this.timeClockForEmployee(actor, employee.id);
  }

  timeClockForEmployee(actor, employeeId, weekStartOverride = null) {
    const employee = this.employeeRecord(actor, employeeId);
    const timezone = this.tenantTimezone(actor);
    const weekStart = payWeekStart(weekStartOverride || localDateForInstant(now(), timezone));
    const week = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    const open = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open' ORDER BY clock_in_at DESC LIMIT 1").get(actor.tenant_id, employeeId);
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const entries = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND clock_in_at >= ? AND clock_in_at < ? ORDER BY clock_in_at").all(actor.tenant_id, employeeId, startUtc, endUtc);
    const includePay = this.canManagePay(actor);
    return {
      employee: mapEmployee(employee),
      timezone,
      week: mapPayWeek(week),
      open_entry: mapTimeEntry(open, timezone, { includePay }),
      entries: entries.map((entry) => mapTimeEntry(entry, timezone, { includePay })),
      current_week_total_minutes: entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0),
      current_week_total_hours_decimal: (entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0) / 60).toFixed(2),
      warning: open && minutesBetween(open.clock_in_at, now()) > IMPLAUSIBLE_SHIFT_MINUTES ? "open_entry_implausibly_long" : "",
    };
  }

  clockIn(actor, payload = {}) {
    const employee = this.activeEmployeeForActor(actor);
    const input = clockNoteSchema.parse(payload);
    const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'").get(actor.tenant_id, employee.id);
    if (existing) return { ...this.timeClockForEmployee(actor, employee.id), idempotent: true };
    const timezone = this.tenantTimezone(actor);
    const clockInAt = now();
    const weekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
    this.requireOpenPayWeek(actor, employee.id, weekStart);
    const rate = this.rateForInstant(actor, employee.id, clockInAt);
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_time_entries
       (id, tenant_id, employee_id, clock_in_at, clock_in_note, rate_cents_snapshot, status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(id, actor.tenant_id, employee.id, clockInAt, input.note ?? null, rate.hourly_rate_cents, actor.id, timestamp, timestamp);
    this.audit(actor, "time.clock_in", "employee", employee.id, employee.portable_id, `${employee.name} clocked in`, { time_entry_id: id });
    return { ...this.timeClockForEmployee(actor, employee.id, weekStart), idempotent: false };
  }

  clockOut(actor, payload = {}) {
    const employee = this.activeEmployeeForActor(actor);
    const input = clockNoteSchema.parse(payload);
    const entry = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'").get(actor.tenant_id, employee.id);
    if (!entry) return { ...this.timeClockForEmployee(actor, employee.id), idempotent: true };
    return this.transaction(() => {
      const timezone = this.tenantTimezone(actor);
      const clockOutAt = now();
      if (new Date(clockOutAt) <= new Date(entry.clock_in_at)) throw error("time_entry_invalid_range", 400);
      const duration = minutesBetween(entry.clock_in_at, clockOutAt);
      const weekStart = payWeekStart(localDateForInstant(entry.clock_in_at, timezone));
      this.requireOpenPayWeek(actor, employee.id, weekStart);
      this.db.prepare(
        `UPDATE employee_time_entries SET clock_out_at = ?, clock_out_note = ?, duration_minutes = ?, status = 'closed',
         implausible = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(clockOutAt, input.note ?? null, duration, bool(duration > IMPLAUSIBLE_SHIFT_MINUTES), now(), entry.id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.clock_out", "employee", employee.id, employee.portable_id, `${employee.name} clocked out`, { time_entry_id: entry.id, duration_minutes: duration });
      return { ...this.timeClockForEmployee(actor, employee.id, weekStart), idempotent: false };
    });
  }

  listTimeEntries(actor, filters = {}) {
    this.requireRole(actor, MANAGER_ROLES);
    const parsed = payWeekFilterSchema.parse(filters);
    const employeeId = parsed.employee_id || this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? ORDER BY name LIMIT 1").get(actor.tenant_id)?.id || "";
    if (!employeeId) return { employee: null, entries: [], week: null, clocked_in: [] };
    const employee = this.employeeRecord(actor, employeeId);
    const timezone = this.tenantTimezone(actor);
    const includePay = this.canManagePay(actor);
    const weekStart = payWeekStart(parsed.week_start_date || localDateForInstant(now(), timezone));
    const week = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const entries = this.db
      .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND clock_in_at >= ? AND clock_in_at < ? ORDER BY clock_in_at")
      .all(actor.tenant_id, employeeId, startUtc, endUtc)
      .map((entry) => mapTimeEntry(entry, timezone, { includePay }));
    const totalMinutes = entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0);
    const clockedIn = this.db
      .prepare("SELECT t.*, e.name AS employee_name FROM employee_time_entries t JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id WHERE t.tenant_id = ? AND t.status = 'open' ORDER BY t.clock_in_at")
      .all(actor.tenant_id)
      .map((row) => ({ ...mapTimeEntry(row, timezone, { includePay }), employee_name: row.employee_name }));
    return { employee: mapEmployee(employee, { includePay }), entries, week: mapPayWeek(week), clocked_in: clockedIn, current_week_total_minutes: totalMinutes, current_week_total_hours_decimal: (totalMinutes / 60).toFixed(2) };
  }

  addTimeEntry(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = adminTimeEntrySchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const timezone = this.tenantTimezone(actor);
      const clockInAt = parseShopDateTime(input.clock_in_at, timezone);
      const clockOutAt = parseShopDateTime(input.clock_out_at, timezone);
      if (new Date(clockOutAt) <= new Date(clockInAt)) throw error("time_entry_invalid_range", 400);
      const overlapping = this.db.prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status <> 'void'
           AND clock_in_at < ? AND COALESCE(clock_out_at, '9999-12-31T00:00:00.000Z') > ?
         LIMIT 1`,
      ).get(actor.tenant_id, employee.id, clockOutAt, clockInAt);
      if (overlapping) throw error("time_entry_overlap", 409);
      const weekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
      this.requireOpenPayWeeksForInterval(actor, employee.id, clockInAt, clockOutAt, timezone);
      const rate = this.rateForInstant(actor, employee.id, clockInAt);
      const duration = minutesBetween(clockInAt, clockOutAt);
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO employee_time_entries
         (id, tenant_id, employee_id, clock_in_at, clock_out_at, clock_in_note, clock_out_note, duration_minutes, rate_cents_snapshot, status, implausible, created_by_user_id, corrected_by_user_id, corrected_at, correction_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, clockInAt, clockOutAt, input.clock_in_note ?? null, input.clock_out_note ?? null, duration, rate.hourly_rate_cents, bool(duration > IMPLAUSIBLE_SHIFT_MINUTES), actor.id, actor.id, timestamp, input.reason, timestamp, timestamp);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.entry_add", "employee", employee.id, employee.portable_id, "Time Entry added by administrator", { time_entry_id: id, reason: input.reason });
      return mapTimeEntry(this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), timezone, { includePay: this.canManagePay(actor) });
    });
  }

  updateTimeEntry(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = timeCorrectionSchema.parse(payload);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("time_entry_not_found", 404);
      if (existing.status === "void") throw error("time_entry_voided", 409);
      const employee = this.employeeRecord(actor, existing.employee_id);
      const timezone = this.tenantTimezone(actor);
      const clockInAt = input.clock_in_at ? parseShopDateTime(input.clock_in_at, timezone) : existing.clock_in_at;
      const clockOutAt = input.clock_out_at === null ? null : input.clock_out_at ? parseShopDateTime(input.clock_out_at, timezone) : existing.clock_out_at;
      if (clockOutAt && new Date(clockOutAt) <= new Date(clockInAt)) throw error("time_entry_invalid_range", 400);
      const status = clockOutAt ? "closed" : "open";
      const duration = clockOutAt ? minutesBetween(clockInAt, clockOutAt) : 0;
      const overlap = this.db.prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND id <> ? AND status <> 'void'
           AND clock_in_at < COALESCE(?, '9999-12-31T00:00:00.000Z')
           AND COALESCE(clock_out_at, '9999-12-31T00:00:00.000Z') > ?
         LIMIT 1`,
      ).get(actor.tenant_id, employee.id, id, clockOutAt, clockInAt);
      if (overlap) throw error("time_entry_overlap", 409);
      const previousWeekStart = payWeekStart(localDateForInstant(existing.clock_in_at, timezone));
      const nextWeekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
      this.requireOpenPayWeek(actor, employee.id, previousWeekStart);
      if (clockOutAt) this.requireOpenPayWeeksForInterval(actor, employee.id, clockInAt, clockOutAt, timezone);
      else this.requireOpenPayWeek(actor, employee.id, nextWeekStart);
      const rate = this.rateForInstant(actor, employee.id, clockInAt);
      const before = mapTimeEntry(existing, timezone, { includePay: true });
      this.db.prepare(
        `UPDATE employee_time_entries SET clock_in_at = ?, clock_out_at = ?, clock_in_note = ?, clock_out_note = ?, duration_minutes = ?,
         rate_cents_snapshot = ?, status = ?, implausible = ?, corrected_by_user_id = ?, corrected_at = ?, correction_reason = ?, before_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(clockInAt, clockOutAt, input.clock_in_note ?? existing.clock_in_note, input.clock_out_note ?? existing.clock_out_note, duration, rate.hourly_rate_cents, status, bool(status === "open" ? minutesBetween(clockInAt, now()) > IMPLAUSIBLE_SHIFT_MINUTES : duration > IMPLAUSIBLE_SHIFT_MINUTES), actor.id, now(), input.reason, JSON.stringify(before), now(), id, actor.tenant_id);
      const updated = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      this.db.prepare("UPDATE employee_time_entries SET after_json = ? WHERE id = ? AND tenant_id = ?").run(JSON.stringify(mapTimeEntry(updated, timezone, { includePay: true })), id, actor.tenant_id);
      const propagationStart = previousWeekStart < nextWeekStart ? previousWeekStart : nextWeekStart;
      this.propagateFollowingOpenWeeks(actor, employee.id, propagationStart);
      this.audit(actor, "time.entry_correct", "employee", employee.id, employee.portable_id, "Time Entry corrected by administrator", { time_entry_id: id, reason: input.reason, before, after: mapTimeEntry(updated, timezone, { includePay: true }) });
      return mapTimeEntry(updated, timezone, { includePay: this.canManagePay(actor) });
    });
  }

  voidTimeEntry(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = voidLedgerSchema.parse(payload);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("time_entry_not_found", 404);
      const employee = this.employeeRecord(actor, existing.employee_id);
      const timezone = this.tenantTimezone(actor);
      const weekStart = payWeekStart(localDateForInstant(existing.clock_in_at, timezone));
      this.requireOpenPayWeek(actor, employee.id, weekStart);
      const voidedAt = now();
      const clockOutAt = existing.clock_out_at || voidedAt;
      this.db.prepare("UPDATE employee_time_entries SET status = 'void', clock_out_at = ?, voided_by_user_id = ?, voided_at = ?, void_reason = ?, duration_minutes = 0, updated_at = ? WHERE id = ? AND tenant_id = ?").run(clockOutAt, actor.id, voidedAt, input.reason, now(), id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.entry_void", "employee", employee.id, employee.portable_id, "Time Entry voided", { time_entry_id: id, reason: input.reason });
      return mapTimeEntry(this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), timezone, { includePay: this.canManagePay(actor) });
    });
  }

  paySummary(actor, employeeId, weekStart) {
    this.requirePayManagement(actor);
    const employee = this.employeeRecord(actor, employeeId);
    const week = this.refreshOpenPayWeek(actor, employee.id, payWeekStart(weekStart || localDateForInstant(now(), this.tenantTimezone(actor))));
    return this.payWeekDetail(actor, employee, week, true);
  }

  myPaySummary(actor, weekStart = null) {
    const employee = this.activeEmployeeForActor(actor);
    const week = this.refreshOpenPayWeek(actor, employee.id, payWeekStart(weekStart || localDateForInstant(now(), this.tenantTimezone(actor))));
    return this.payWeekDetail(actor, employee, week, true);
  }

  normalizeAnnouncementInput(actor, input, existing = null) {
    const timezone = this.tenantTimezone(actor);
    const publishAt = input.publish_at !== undefined
      ? normalizeTimedDateTime(input.publish_at, timezone)
      : existing?.publish_at || now();
    const expiresAt = input.expires_at === null || input.expires_at === ""
      ? null
      : input.expires_at !== undefined
        ? normalizeTimedDateTime(input.expires_at, timezone)
        : existing?.expires_at || null;
    if (expiresAt && new Date(expiresAt) <= new Date(publishAt)) throw error("announcement_date_invalid", 400);
    return { ...input, publish_at: publishAt, expires_at: expiresAt };
  }

  announcementRow(actor, announcementId) {
    const row = this.db
      .prepare(
        `SELECT a.*, u.display_name AS author_name
         FROM employee_announcements a
         JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
         WHERE a.id = ? AND a.tenant_id = ?`,
      )
      .get(announcementId, actor.tenant_id);
    if (!row) throw error("announcement_not_found", 404);
    return row;
  }

  announcement(actor, announcementId) {
    this.requireRole(actor, ADMIN_ROLES);
    return mapAnnouncement(this.announcementRow(actor, announcementId));
  }

  listAnnouncements(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return {
      items: this.db
        .prepare(
          `SELECT a.*, u.display_name AS author_name
           FROM employee_announcements a
           JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
           WHERE a.tenant_id = ?
           ORDER BY a.archived_at IS NOT NULL, a.publish_at DESC, a.created_at DESC`,
        )
        .all(actor.tenant_id)
        .map(mapAnnouncement),
    };
  }

  createAnnouncement(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = this.normalizeAnnouncementInput(actor, announcementSchema.parse(payload));
    const id = randomUUID();
    const timestamp = now();
    return this.transaction(() => {
      this.db.prepare(
        `INSERT INTO employee_announcements
         (id, portable_id, tenant_id, author_user_id, title, body, publish_at, expires_at, audience_role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, portable("employee_announcement"), actor.tenant_id, actor.id, input.title, input.body, input.publish_at, input.expires_at, input.audience_role, timestamp, timestamp);
      const announcement = this.announcementRow(actor, id);
      this.audit(actor, "announcement.create", "employee_announcement", id, announcement.portable_id, `Announcement ${announcement.title} created`, {
        audience_role: announcement.audience_role,
        publish_at: announcement.publish_at,
        expires_at: announcement.expires_at,
      });
      return mapAnnouncement(announcement);
    });
  }

  updateAnnouncement(actor, announcementId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.announcementRow(actor, announcementId);
    if (existing.archived_at) throw error("announcement_archived", 409);
    const input = announcementUpdateSchema.parse(payload);
    if (!Object.keys(input).length) throw error("no_updates");
    const normalized = this.normalizeAnnouncementInput(actor, input, existing);
    const fields = [];
    const values = [];
    for (const key of ["title", "body", "publish_at", "expires_at", "audience_role"]) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        fields.push(`${key} = ?`);
        values.push(normalized[key]);
      }
    }
    fields.push("updated_at = ?");
    values.push(now(), announcementId, actor.tenant_id);
    return this.transaction(() => {
      this.db.prepare(`UPDATE employee_announcements SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      const updated = this.announcementRow(actor, announcementId);
      this.audit(actor, "announcement.update", "employee_announcement", announcementId, updated.portable_id, `Announcement ${updated.title} updated`, {
        before: {
          title: existing.title,
          body: existing.body,
          publish_at: existing.publish_at,
          expires_at: existing.expires_at,
          audience_role: existing.audience_role,
        },
        after: normalized,
      });
      return mapAnnouncement(updated);
    });
  }

  archiveAnnouncement(actor, announcementId) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.announcementRow(actor, announcementId);
    if (existing.archived_at) return mapAnnouncement(existing);
    return this.transaction(() => {
      this.db
        .prepare("UPDATE employee_announcements SET archived_at = ?, archived_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now(), actor.id, now(), announcementId, actor.tenant_id);
      const archived = this.announcementRow(actor, announcementId);
      this.audit(actor, "announcement.archive", "employee_announcement", announcementId, archived.portable_id, `Announcement ${archived.title} archived`);
      return mapAnnouncement(archived);
    });
  }

  visibleAnnouncementRows(actor, employee, announcementId = null) {
    const timestamp = now();
    const params = [employee.id, actor.tenant_id, timestamp, timestamp, employee.role];
    let where = "a.tenant_id = ? AND a.archived_at IS NULL AND a.publish_at <= ? AND (a.expires_at IS NULL OR a.expires_at > ?) AND a.audience_role IN ('all', ?)";
    if (announcementId) {
      where += " AND a.id = ?";
      params.push(announcementId);
    }
    return this.db
      .prepare(
        `SELECT a.*, u.display_name AS author_name, r.read_at
         FROM employee_announcements a
         JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
         LEFT JOIN employee_announcement_reads r ON r.tenant_id = a.tenant_id AND r.announcement_id = a.id AND r.employee_id = ?
         WHERE ${where}
         ORDER BY a.publish_at DESC, a.created_at DESC`,
      )
      .all(...params);
  }

  portalAnnouncements(actor) {
    const employee = this.activeEmployeeForActor(actor);
    return { employee: mapEmployee(employee), items: this.visibleAnnouncementRows(actor, employee).map(mapAnnouncement) };
  }

  portalAnnouncement(actor, announcementId) {
    const employee = this.activeEmployeeForActor(actor);
    return this.transaction(() => {
      const row = this.visibleAnnouncementRows(actor, employee, announcementId)[0];
      if (!row) throw error("announcement_not_found", 404);
      if (!row.read_at) {
        this.db
          .prepare(
            `INSERT INTO employee_announcement_reads (id, tenant_id, announcement_id, employee_id, user_id, read_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(tenant_id, announcement_id, employee_id) DO UPDATE SET read_at = COALESCE(employee_announcement_reads.read_at, excluded.read_at)`,
          )
          .run(randomUUID(), actor.tenant_id, announcementId, employee.id, actor.id, now());
      }
      const updated = this.visibleAnnouncementRows(actor, employee, announcementId)[0];
      return mapAnnouncement(updated);
    });
  }

  messageParticipants(actor) {
    this.activeEmployeeForActor(actor);
    return {
      items: this.db
        .prepare(
          `SELECT e.*, u.display_name, u.email AS user_email
           FROM employees e
           JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
           WHERE e.tenant_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1 AND u.id <> ?
           ORDER BY e.name, e.employee_number`,
        )
        .all(actor.tenant_id, actor.id)
        .map((row) => ({
          user_id: row.user_id,
          display_name: row.display_name || row.name,
          employee_id: row.id,
          employee_number: row.employee_number,
          role: row.role,
          email: row.user_email || row.email,
        })),
    };
  }

  sendDirectMessage(actor, payload) {
    const senderEmployee = this.activeEmployeeForActor(actor);
    const input = directMessageSchema.parse(payload);
    if (input.sender_user_id && input.sender_user_id !== actor.id) throw error("message_sender_spoof", 403);
    if (input.recipient_user_id === actor.id) throw error("message_recipient_invalid", 400);
    const recipient = this.activeEmployeeForUser(actor, input.recipient_user_id);
    const id = randomUUID();
    const portableId = portable("employee_direct_message");
    const timestamp = now();
    return this.transaction(() => {
      this.db.prepare(
        `INSERT INTO employee_direct_messages
         (id, portable_id, tenant_id, sender_user_id, recipient_user_id, body, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, portableId, actor.tenant_id, actor.id, recipient.user_id, input.body, timestamp, timestamp);
      this.audit(actor, "message.send", "employee_message", id, portableId, `Message sent to ${recipient.display_name || recipient.name}`, {
        sender_employee_id: senderEmployee.id,
        recipient_employee_id: recipient.id,
      });
      return this.messageById(actor, id);
    });
  }

  messageById(actor, id) {
    const row = this.db
      .prepare(
        `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
         FROM employee_direct_messages m
         JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
         JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
         WHERE m.id = ? AND m.tenant_id = ? AND (m.sender_user_id = ? OR m.recipient_user_id = ?)`,
      )
      .get(id, actor.tenant_id, actor.id, actor.id);
    if (!row) throw error("message_not_found", 404);
    return mapMessage(row, actor.id);
  }

  listMessageConversations(actor) {
    this.activeEmployeeForActor(actor);
    const rows = this.db
      .prepare(
        `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
         FROM employee_direct_messages m
         JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
         JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND (m.sender_user_id = ? OR m.recipient_user_id = ?)
         ORDER BY m.sent_at DESC, m.id DESC`,
      )
      .all(actor.tenant_id, actor.id, actor.id);
    const conversations = new Map();
    for (const row of rows) {
      const otherUserId = row.sender_user_id === actor.id ? row.recipient_user_id : row.sender_user_id;
      const existing = conversations.get(otherUserId) || {
        user_id: otherUserId,
        display_name: row.sender_user_id === actor.id ? row.recipient_name : row.sender_name,
        unread_count: 0,
        last_message: mapMessage(row, actor.id),
      };
      if (row.recipient_user_id === actor.id && !row.recipient_read_at) existing.unread_count += 1;
      conversations.set(otherUserId, existing);
    }
    return { items: [...conversations.values()] };
  }

  historicalMessageParticipant(actor, otherUserId) {
    const row = this.db
      .prepare(
        `SELECT e.*, u.display_name, u.email AS user_email, u.active AS user_active
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ?
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, otherUserId);
    if (!row) throw error("message_not_found", 404);
    return row;
  }

  messageConversation(actor, otherUserId) {
    this.activeEmployeeForActor(actor);
    const other = this.historicalMessageParticipant(actor, otherUserId);
    const readAt = now();
    return this.transaction(() => {
      this.db
        .prepare("UPDATE employee_direct_messages SET recipient_read_at = COALESCE(recipient_read_at, ?) WHERE tenant_id = ? AND sender_user_id = ? AND recipient_user_id = ?")
        .run(readAt, actor.tenant_id, other.user_id, actor.id);
      const messages = this.db
        .prepare(
          `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
           FROM employee_direct_messages m
           JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
           JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
           WHERE m.tenant_id = ? AND ((m.sender_user_id = ? AND m.recipient_user_id = ?) OR (m.sender_user_id = ? AND m.recipient_user_id = ?))
           ORDER BY m.sent_at ASC, m.id ASC`,
        )
        .all(actor.tenant_id, actor.id, other.user_id, other.user_id, actor.id)
        .map((row) => mapMessage(row, actor.id));
      return {
        participant: {
          user_id: other.user_id,
          display_name: other.display_name || other.name,
          employee_id: other.id,
          employee_number: other.employee_number,
          role: other.role,
        },
        messages,
      };
    });
  }

  listPayWeeks(actor, filters = {}) {
    this.requirePayManagement(actor);
    const parsed = payWeekFilterSchema.parse(filters);
    const params = [actor.tenant_id];
    let where = "tenant_id = ?";
    if (parsed.employee_id) {
      this.employeeRecord(actor, parsed.employee_id);
      where += " AND employee_id = ?";
      params.push(parsed.employee_id);
    }
    const rows = this.db.prepare(`SELECT * FROM employee_pay_weeks WHERE ${where} ORDER BY week_start_date DESC, employee_id`).all(...params);
    return rows.map(mapPayWeek);
  }

  payWeekDetail(actor, employee, week, includeLedger = true) {
    const mapped = mapPayWeek(week);
    const ledger = includeLedger ? {
      advances: this.db.prepare("SELECT * FROM employee_pay_advances WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY advance_date, created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "advance")),
      adjustments: this.db.prepare("SELECT * FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "adjustment")),
      manual_payments: this.db.prepare("SELECT * FROM employee_pay_manual_payments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY payment_date, created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "manual_payment")),
    } : {};
    return { employee: mapEmployee(employee), week: mapped, ...ledger, formula: "Estimated Amount Due = Opening Carryover + Gross Pay + Positive Adjustments - Negative Adjustments - Advances - Manual Payments" };
  }

  recordPayAdvance(actor, payload) {
    this.requirePayManagement(actor);
    const input = advanceSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_advances (id, tenant_id, employee_id, pay_week_start, amount_cents, advance_date, note, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.amount_cents, input.advance_date, input.note, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.advance_create", "employee", employee.id, employee.portable_id, "Employee pay advance recorded", { advance_id: id, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  }

  recordPayAdjustment(actor, payload) {
    this.requirePayManagement(actor);
    const input = adjustmentSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_adjustments (id, tenant_id, employee_id, pay_week_start, direction, amount_cents, reason, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.direction, input.amount_cents, input.reason, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.adjustment_create", "employee", employee.id, employee.portable_id, "Employee pay adjustment recorded", { adjustment_id: id, direction: input.direction, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  }

  recordManualPayment(actor, payload) {
    this.requirePayManagement(actor);
    const input = manualPaymentSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_manual_payments (id, tenant_id, employee_id, pay_week_start, amount_cents, payment_date, method, reference, note, recorded_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.amount_cents, input.payment_date, input.method ?? null, input.reference ?? null, input.note ?? null, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.manual_payment_create", "employee", employee.id, employee.portable_id, "Manual employee payment recorded", { payment_id: id, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  }

  voidPayLedger(actor, type, id, payload) {
    this.requirePayManagement(actor);
    if (!PAY_LEDGER_TYPES.includes(type)) throw error("pay_ledger_type_invalid", 400);
    const input = voidLedgerSchema.parse(payload);
    return this.transaction(() => {
      const table = type === "advance" ? "employee_pay_advances" : type === "adjustment" ? "employee_pay_adjustments" : "employee_pay_manual_payments";
      const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(id, actor.tenant_id);
      if (!row) throw error("pay_ledger_not_found", 404);
      this.requireOpenPayWeek(actor, row.employee_id, row.pay_week_start);
      if (row.voided_at) return this.paySummary(actor, row.employee_id, row.pay_week_start);
      this.db.prepare(`UPDATE ${table} SET voided_at = ?, voided_by_user_id = ?, void_reason = ? WHERE id = ? AND tenant_id = ?`).run(now(), actor.id, input.reason, id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, row.employee_id, row.pay_week_start);
      const employee = this.employeeRecord(actor, row.employee_id);
      this.audit(actor, `pay.${type}_void`, "employee", row.employee_id, employee.portable_id, "Employee pay ledger record voided", { ledger_id: id, type, reason: input.reason });
      return this.paySummary(actor, row.employee_id, row.pay_week_start);
    });
  }

  closePayWeek(actor, employeeId, weekStart) {
    this.requirePayManagement(actor);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, employeeId);
      let week = this.ensurePayWeek(actor, employee.id, payWeekStart(weekStart));
      if (week.status === "closed") return this.payWeekDetail(actor, employee, week, true);
      const laterClosed = this.db.prepare("SELECT id FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date > ? AND status = 'closed' LIMIT 1").get(actor.tenant_id, employee.id, week.week_start_date);
      if (laterClosed) throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.requireNoOpenTimeEntryInPayWeek(actor, employee.id, week, this.tenantTimezone(actor));
      week = this.refreshOpenPayWeek(actor, employee.id, week.week_start_date);
      const calc = this.payWeekCalculation(actor, employee.id, week.week_start_date, week.opening_carryover_cents);
      const timestamp = now();
      this.db.prepare(
        `UPDATE employee_pay_weeks SET status = 'closed', valid_minutes = ?, gross_pay_cents = ?, positive_adjustments_cents = ?,
         negative_adjustments_cents = ?, advances_cents = ?, manual_payments_cents = ?, estimated_amount_due_cents = ?,
         closing_carryover_cents = ?, rate_breakdown_json = ?, snapshot_json = ?, closed_by_user_id = ?, closed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(calc.valid_minutes, calc.gross_pay_cents, calc.positive_adjustments_cents, calc.negative_adjustments_cents, calc.advances_cents, calc.manual_payments_cents, calc.estimated_amount_due_cents, calc.estimated_amount_due_cents, JSON.stringify(calc.rate_breakdown), JSON.stringify(calc), actor.id, timestamp, timestamp, week.id, actor.tenant_id);
      const nextStart = addDays(week.week_end_date, 1);
      const next = this.ensurePayWeek(actor, employee.id, nextStart, calc.estimated_amount_due_cents);
      if (next.status === "open") this.updateOpenCarryoverChain(actor, employee.id, next.week_start_date, calc.estimated_amount_due_cents);
      this.audit(actor, "pay.week_close", "employee", employee.id, employee.portable_id, "Employee pay week closed", { week_start_date: week.week_start_date, estimated_amount_due_cents: calc.estimated_amount_due_cents });
      week = this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id);
      return this.payWeekDetail(actor, employee, week, true);
    });
  }

  reopenPayWeek(actor, employeeId, weekStart, payload) {
    this.requirePayManagement(actor);
    const input = reopenPayWeekSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, employeeId);
      const week = this.ensurePayWeek(actor, employee.id, weekStart);
      if (week.status !== "closed") return this.payWeekDetail(actor, employee, week, true);
      const laterClosed = this.db.prepare("SELECT id FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date > ? AND status = 'closed' LIMIT 1").get(actor.tenant_id, employee.id, week.week_start_date);
      if (laterClosed) throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.db.prepare(
        `UPDATE employee_pay_weeks SET status = 'open', closing_carryover_cents = NULL, reopened_by_user_id = ?, reopened_at = ?,
         reopen_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(actor.id, now(), input.reason, now(), week.id, actor.tenant_id);
      const refreshed = this.refreshOpenPayWeek(actor, employee.id, week.week_start_date);
      this.updateOpenCarryoverChain(actor, employee.id, addDays(refreshed.week_end_date, 1), refreshed.estimated_amount_due_cents);
      this.audit(actor, "pay.week_reopen", "employee", employee.id, employee.portable_id, "Employee pay week reopened", { week_start_date: week.week_start_date, reason: input.reason });
      return this.payWeekDetail(actor, employee, this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id), true);
    });
  }

  createCustomer(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        contact_name: z.string().min(1),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema,
        active: z.boolean().default(true),
        tax_exempt: z.boolean().default(false),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const id = randomUUID();
    const pid = portable("customer");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "customer", "C");
    this.db
      .prepare(
        `INSERT INTO customers
         (id, portable_id, tenant_id, customer_number, contact_name, business_name, email, phone,
          billing_line1, billing_line2, billing_city, billing_state, billing_postal_code, billing_country,
          active, tax_exempt, tax_exemption_note, internal_notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pid,
        actor.tenant_id,
        number,
        input.contact_name,
        input.business_name ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.billing_address.line1,
        input.billing_address.line2 ?? null,
        input.billing_address.city,
        input.billing_address.state,
        input.billing_address.postal_code,
        input.billing_address.country,
        bool(input.active),
        bool(input.tax_exempt),
        input.tax_exemption_note ?? null,
        input.internal_notes ?? null,
        timestamp,
        timestamp,
      );
    this.audit(actor, "customer.create", "customer", id, pid, `Customer ${input.contact_name} created`, {
      customer_number: number,
      tax_exempt: input.tax_exempt,
    });
    return this.customer(actor, id);
  }

  listCustomers(actor, filters = {}) {
    const params = [actor.tenant_id];
    let where = "tenant_id = ?";
    if (filters.status === "active") where += " AND active = 1";
    if (filters.status === "inactive") where += " AND active = 0";
    if (filters.search) {
      where += " AND (contact_name LIKE ? OR business_name LIKE ? OR email LIKE ? OR phone LIKE ?)";
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }
    return this.db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY customer_number DESC`).all(...params).map(mapCustomer);
  }

  customer(actor, id) {
    const row = this.db.prepare("SELECT * FROM customers WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("customer_not_found", 404);
    const customer = mapCustomer(row);
    customer.related_estimates = this.db
      .prepare("SELECT id, estimate_number, status, total_cents FROM estimates WHERE customer_id = ? AND tenant_id = ? ORDER BY estimate_number DESC")
      .all(id, actor.tenant_id);
    customer.related_orders = this.db
      .prepare("SELECT id, order_number, status, total_cents FROM orders WHERE customer_id = ? AND tenant_id = ? ORDER BY order_number DESC")
      .all(id, actor.tenant_id);
    return customer;
  }

  updateCustomer(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    this.customer(actor, id);
    const input = z
      .object({
        contact_name: z.string().min(1).optional(),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema.optional(),
        active: z.boolean().optional(),
        tax_exempt: z.boolean().optional(),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "billing_address") {
        fields.push("billing_line1 = ?", "billing_line2 = ?", "billing_city = ?", "billing_state = ?", "billing_postal_code = ?", "billing_country = ?");
        values.push(value.line1, value.line2 ?? null, value.city, value.state, value.postal_code, value.country);
      } else {
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE customers SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    const updated = this.customer(actor, id);
    this.audit(actor, "customer.update", "customer", id, updated.portable_id, "Customer updated", input);
    return updated;
  }

  validateSameTenantUser(actor, userId) {
    if (!userId) return null;
    const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(userId, actor.tenant_id);
    if (!user) throw error("assigned_user_not_same_tenant", 400);
    return userId;
  }

  prepareItems(actor, items) {
    return z.array(quickItemSchema).min(1).parse(items).map((item, position) => ({
      ...item,
      position,
      title: normalizeTitle(item.title),
      assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
      line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
    }));
  }

  prepareWorkspaceItems(actor, items) {
    return z.array(workspaceItemSchema).min(1).parse(items).map((item, position) => {
      const nextStage = item.completed ? "complete" : item.production_stage === "complete" ? "complete" : item.production_stage;
      return {
        ...item,
        position,
        title: normalizeTitle(item.title),
        production_stage: nextStage,
        completed: item.completed || nextStage === "complete",
        assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
        line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
      };
    });
  }

  insertOrderItems(actor, orderId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), item.portable_id || portable("order_item"), actor.tenant_id, orderId, item.source_estimate_item_id ?? null, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.production_stage || "not_started", bool(item.completed), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  auditProductionTransitions(actor, current, next, timestamp) {
    if (current.production_stage !== next.production_stage) {
      this.audit(actor, "production.stage_move", "order_item", current.id, current.portable_id, `Item moved from ${current.production_stage} to ${next.production_stage}`, { from: current.production_stage, to: next.production_stage, order_id: current.order_id });
    }
    if (!current.completed && next.completed) {
      this.audit(actor, "production.complete", "order_item", current.id, current.portable_id, "Production item completed", { order_id: current.order_id, stage: next.production_stage, occurred_with_order_updated_at: timestamp });
    }
    if (current.completed && !next.completed) {
      this.audit(actor, "production.reopen", "order_item", current.id, current.portable_id, "Production item reopened", { order_id: current.order_id, stage: next.production_stage, occurred_with_order_updated_at: timestamp });
    }
  }

  activeWorkOrderMembership(actor, orderItemId) {
    return this.db
      .prepare(
        `SELECT wo.*
         FROM work_order_items woi
         JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
         WHERE woi.tenant_id = ? AND woi.order_item_id = ? AND woi.active = 1 AND wo.status = 'active'
         LIMIT 1`,
      )
      .get(actor.tenant_id, orderItemId);
  }

  assertPostReleaseItemChanges(actor, existing, nextItems) {
    const released = Boolean(existing.sent_to_production_at || existing.work_orders?.length);
    if (!released) return;
    const currentById = new Map(existing.items.map((item) => [item.id, item]));
    const nextById = new Map(nextItems.filter((item) => item.id).map((item) => [item.id, item]));
    for (const current of existing.items) {
      const hasHistory = this.db.prepare("SELECT id FROM work_order_items WHERE tenant_id = ? AND order_item_id = ? LIMIT 1").get(actor.tenant_id, current.id);
      if (!nextById.has(current.id) && (current.production_required || hasHistory)) throw error("released_production_item_history_protected", 409);
    }
    for (const next of nextItems) {
      if (!next.id) {
        if (next.production_required) throw error("released_production_item_assignment_required", 409);
        continue;
      }
      const current = currentById.get(next.id);
      if (!current) continue;
      const activeMembership = this.activeWorkOrderMembership(actor, next.id);
      if (Boolean(current.production_required) !== Boolean(next.production_required)) throw error("released_production_required_change_requires_regroup", 409);
      if (activeMembership && (!["not_started", "ready"].includes(activeMembership.production_stage) || activeMembership.completed)) {
        const identityChanged =
          current.title !== next.title ||
          current.description !== next.description ||
          current.quantity_decimal !== next.quantity_decimal ||
          current.production_stage !== next.production_stage ||
          Boolean(current.completed) !== Boolean(next.completed);
        if (identityChanged) throw error("started_work_order_item_history_protected", 409);
      }
    }
  }

  assertBundledItemChanges(actor, documentType, documentId, currentItems, nextItems) {
    const bundleRows = this.db
      .prepare("SELECT item_id FROM commercial_bundle_items WHERE tenant_id = ? AND document_type = ? AND document_id = ? AND active = 1")
      .all(actor.tenant_id, documentType, documentId);
    if (!bundleRows.length) return;
    const bundledIds = new Set(bundleRows.map((row) => row.item_id));
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const nextById = new Map(nextItems.filter((item) => item.id).map((item) => [item.id, item]));
    for (const itemId of bundledIds) {
      const current = currentById.get(itemId);
      const next = nextById.get(itemId);
      if (!current || !next) throw error("bundle_membership_requires_resave", 409);
      if (
        current.quantity_decimal !== next.quantity_decimal ||
        current.unit_price_cents !== next.unit_price_cents ||
        Boolean(current.taxable) !== Boolean(next.taxable)
      ) throw error("bundle_membership_requires_resave", 409);
    }
  }

  updateOrderItemsDifferential(actor, orderId, existingItems, nextItems, timestamp) {
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const submittedExistingIds = new Set();
    for (const item of nextItems) {
      if (!item.id) continue;
      if (!existingById.has(item.id)) throw error("order_item_not_found", 404);
      submittedExistingIds.add(item.id);
    }
    const tempPosition = this.db.prepare("UPDATE order_items SET position = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND order_id = ?");
    nextItems.forEach((item, index) => {
      if (item.id) tempPosition.run(-(index + 1), timestamp, item.id, actor.tenant_id, orderId);
    });
    for (const current of existingItems) {
      if (!submittedExistingIds.has(current.id)) {
        this.db.prepare("DELETE FROM order_items WHERE id = ? AND tenant_id = ? AND order_id = ?").run(current.id, actor.tenant_id, orderId);
      }
    }
    const update = this.db.prepare(
      `UPDATE order_items
       SET position = ?, title = ?, description = ?, quantity_decimal = ?, unit_price_cents = ?, line_total_cents = ?,
           taxable = ?, production_required = ?, production_stage = ?, completed = ?, due_date = ?,
           assigned_user_id = ?, internal_note = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND order_id = ?`,
    );
    const insert = this.db.prepare(
      `INSERT INTO order_items
       (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
        unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
        assigned_user_id, internal_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of nextItems) {
      if (item.id) {
        const current = existingById.get(item.id);
        const next = { ...current, ...item };
        update.run(item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.production_stage, bool(item.completed), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, item.id, actor.tenant_id, orderId);
        this.auditProductionTransitions(actor, current, next, timestamp);
      } else {
        insert.run(randomUUID(), portable("order_item"), actor.tenant_id, orderId, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.production_stage, bool(item.completed), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
      }
    }
  }

  assertInvoicedFinancialLock(existing, nextItems, nextDiscount) {
    if (nextDiscount !== undefined && nextDiscount !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
    const currentIds = existing.items.map((item) => item.id);
    const nextIds = nextItems.map((item) => item.id).filter(Boolean);
    if (currentIds.length !== nextIds.length || currentIds.some((id, index) => nextIds[index] !== id)) throw error("invoiced_order_financial_lock", 409);
    const currentById = new Map(existing.items.map((item) => [item.id, item]));
    for (const next of nextItems) {
      const current = currentById.get(next.id);
      if (
        !current ||
        current.description !== next.description ||
        current.quantity_decimal !== next.quantity_decimal ||
        current.unit_price_cents !== next.unit_price_cents ||
        Boolean(current.taxable) !== Boolean(next.taxable)
      ) throw error("invoiced_order_financial_lock", 409);
    }
  }

  customerSnapshot(actor, customerId) {
    const customer = this.customer(actor, customerId);
    const tenant = this.tenant(actor.tenant_id);
    return { customer, tenant, tax_exempt: customer.tax_exempt, tax_rate: tenant.sales_tax_rate_basis_points };
  }

  createEstimate(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        document_date: z.string().default(today),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    const items = this.prepareItems(actor, input.items);
    const snapshot = this.customerSnapshot(actor, input.customer_id);
    const totals = documentTotals(items, input.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
    return this.transaction(() => {
      const id = randomUUID();
      const pid = portable("estimate");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "estimate", "E");
      this.db
        .prepare(
          `INSERT INTO estimates
           (id, portable_id, tenant_id, customer_id, estimate_number, document_date, expires_at, follow_up_at, status,
            customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
            internal_notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, input.customer_id, number, input.document_date, input.expires_at ?? null, input.follow_up_at ?? null, input.status, bool(snapshot.tax_exempt), snapshot.tax_rate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, input.internal_notes ?? null, timestamp, timestamp);
      this.insertEstimateItems(actor, id, items, timestamp);
      this.audit(actor, "estimate.create", "estimate", id, pid, `Quote ${number} created`, totals);
      return this.estimate(actor, id);
    });
  }

  insertEstimateItems(actor, estimateId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO estimate_items
           (id, portable_id, tenant_id, estimate_id, position, title, description, quantity_decimal, unit_price_cents, line_total_cents,
            taxable, production_required, due_date, assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), portable("estimate_item"), actor.tenant_id, estimateId, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  estimate(actor, id) {
    const row = this.db.prepare("SELECT * FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("estimate_not_found", 404);
    const items = this.db
      .prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND tenant_id = ? ORDER BY position")
      .all(id, actor.tenant_id)
      .map((item) => mapItem(item, "estimate_id"));
    const estimate = mapEstimate(row, items);
    estimate.bundles = this.listCommercialBundles(actor, "estimate", id);
    return estimate;
  }

  listEstimates(actor) {
    return this.db.prepare("SELECT * FROM estimates WHERE tenant_id = ? ORDER BY estimate_number DESC").all(actor.tenant_id).map((row) => mapEstimate(row));
  }

  updateEstimate(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.estimate(actor, id);
    if (existing.converted_order_id) throw error("converted_estimate_locked", 409);
    const input = z
      .object({
        document_date: z.string().optional(),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).optional(),
        discount_cents: z.number().int().nonnegative().optional(),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1).optional(),
      })
      .parse(payload);
    if (!Object.keys(input).length) throw error("no_updates");
    const fields = [];
    const values = [];
    return this.transaction(() => {
      if (input.items || input.discount_cents !== undefined) {
        const snapshot = { tax_exempt: existing.customer_tax_exempt_snapshot, tax_rate: existing.tax_rate_basis_points_snapshot };
        const items = input.items ? this.prepareItems(actor, input.items) : existing.items;
        if (input.items) this.assertBundledItemChanges(actor, "estimate", id, existing.items, items);
        const totals = documentTotals(items, input.discount_cents ?? existing.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
        Object.assign(input, totals);
        if (input.items) {
          this.db.prepare("DELETE FROM estimate_items WHERE estimate_id = ? AND tenant_id = ?").run(id, actor.tenant_id);
          this.insertEstimateItems(actor, id, items);
        }
      }
      for (const [key, value] of Object.entries(input)) {
        if (key === "items") continue;
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
      fields.push("updated_at = ?");
      values.push(now(), id, actor.tenant_id);
      this.db.prepare(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      if (this.db.prepare("SELECT id FROM commercial_bundles WHERE tenant_id = ? AND document_type = 'estimate' AND document_id = ? AND active = 1 LIMIT 1").get(actor.tenant_id, id)) {
        this.recalculateDocumentTotalsForBundles(actor, "estimate", id);
      }
      const updated = this.estimate(actor, id);
      this.audit(actor, "estimate.update", "estimate", id, updated.portable_id, "Quote updated", input);
      return updated;
    });
  }

  duplicateEstimate(actor, id) {
    const source = this.estimate(actor, id);
    return this.createEstimate(actor, {
      customer_id: source.customer_id,
      document_date: today(),
      expires_at: source.expires_at,
      follow_up_at: source.follow_up_at,
      status: "draft",
      discount_cents: source.discount_cents,
      internal_notes: source.internal_notes,
      items: source.items.map(({ title, description, quantity_decimal, unit_price_cents, taxable, production_required, due_date, assigned_user_id, internal_note }) => ({
        title,
        description,
        quantity_decimal,
        unit_price_cents,
        taxable,
        production_required,
        due_date,
        assigned_user_id,
        internal_note,
      })),
    });
  }

  convertEstimate(actor, id) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT converted_order_id FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("estimate_not_found", 404);
      if (existing.converted_order_id) {
        const order = this.order(actor, existing.converted_order_id);
        return { order, already_converted: true };
      }
      const estimate = this.estimate(actor, id);
      const order = this.createOrderInternal(actor, {
        customer_id: estimate.customer_id,
        source_estimate_id: id,
        title: `Order from Quote ${estimate.estimate_number}`,
        document_date: today(),
        due_date: null,
        status: "active",
        discount_cents: estimate.discount_cents,
        internal_notes: estimate.internal_notes,
        snapshot: {
          customer_tax_exempt_snapshot: estimate.customer_tax_exempt_snapshot,
          tax_rate_basis_points_snapshot: estimate.tax_rate_basis_points_snapshot,
        },
        items: estimate.items.map((item) => ({
          ...item,
          source_estimate_item_id: item.id,
        })),
      });
      const itemIdMap = new Map(order.items.map((item) => [item.source_estimate_item_id, item.id]));
      this.copyBundles(actor, "estimate", id, "order", order.id, itemIdMap);
      this.db.prepare("UPDATE estimates SET status = 'accepted', converted_order_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(order.id, now(), id, actor.tenant_id);
      this.audit(actor, "estimate.convert", "estimate", id, estimate.portable_id, `Quote ${estimate.estimate_number} converted to ${order.order_number}`, { order_id: order.id });
      return { order: this.order(actor, order.id), already_converted: false };
    });
  }

  createOrder(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        title: z.string().trim().min(1).max(160),
        document_date: z.string().default(today),
        due_date: z.string().nullable().optional(),
        status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    this.customer(actor, input.customer_id);
    const items = this.prepareItems(actor, input.items);
    return this.transaction(() => this.createOrderInternal(actor, { ...input, items }));
  }

  createOrderInternal(actor, payload) {
    const snapshot = payload.snapshot ?? this.customerSnapshot(actor, payload.customer_id);
    const taxExempt = snapshot.customer_tax_exempt_snapshot ?? snapshot.tax_exempt;
    const taxRate = snapshot.tax_rate_basis_points_snapshot ?? snapshot.tax_rate;
    const totals = documentTotals(payload.items, payload.discount_cents ?? 0, taxRate, taxExempt);
    const id = randomUUID();
    const pid = portable("order");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "order", "O");
    this.db
      .prepare(
        `INSERT INTO orders
         (id, portable_id, tenant_id, customer_id, source_estimate_id, order_number, document_date, due_date, status,
          customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
          internal_notes, title, production_grouping_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, pid, actor.tenant_id, payload.customer_id, payload.source_estimate_id ?? null, number, payload.document_date ?? today(), payload.due_date ?? null, payload.status ?? "draft", bool(taxExempt), taxRate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, payload.internal_notes ?? null, normalizeTitle(payload.title, `Order ${number}`), payload.production_grouping_mode ?? null, timestamp, timestamp);
    payload.items.forEach((item, position) => {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), portable("order_item"), actor.tenant_id, id, item.source_estimate_item_id ?? null, position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    });
    this.audit(actor, "order.create", "order", id, pid, `Order ${number} created`, totals);
    return this.order(actor, id);
  }

  listOrders(actor) {
    return this.db.prepare("SELECT * FROM orders WHERE tenant_id = ? ORDER BY order_number DESC").all(actor.tenant_id).map((row) => {
      const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(row.id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
      const order = mapOrder(row, items);
      order.customer_summary = this.db.prepare("SELECT contact_name, business_name FROM customers WHERE id = ? AND tenant_id = ?").get(row.customer_id, actor.tenant_id) ?? null;
      order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(row.id, actor.tenant_id) ?? null;
      return order;
    });
  }

  order(actor, id) {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("order_not_found", 404);
    const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    const order = mapOrder(row, items);
    const workOrders = this.workOrderRows(actor, id).map((workOrder) => mapWorkOrder(workOrder, this.workOrderItems(actor, workOrder.id)));
    order.work_orders = workOrders;
    if (workOrders.length) {
      const completed = workOrders.filter((workOrder) => workOrder.completed || workOrder.production_stage === "complete").length;
      order.production_progress = { completed, total: workOrders.length, percent: Math.round((completed / workOrders.length) * 100) };
      order.production_status = deriveProductionStatus(workOrders);
    }
    order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(id, actor.tenant_id) ?? null;
    order.bundles = this.listCommercialBundles(actor, "order", id);
    return order;
  }

  orderWorkspace(actor, id) {
    const order = this.order(actor, id);
    return {
      order,
      customer: this.customer(actor, order.customer_id),
      users: this.users(actor).filter((user) => user.active),
      attachments: this.listOrderAttachments(actor, id),
    };
  }

  ensureSchedulingDefaults(actor) {
    const timestamp = now();
    const departments = [
      ["Production", "Production scheduling", "#7B3DA6", 10],
      ["Installation", "Installation scheduling", "#3F7FC4", 20],
      ["Sales", "Sales scheduling", "#E06F00", 30],
      ["Office/Administration", "Office and administration scheduling", "#a7b2c3", 40],
    ];
    for (const [name, description, color, displayOrder] of departments) {
      const exists = this.db.prepare("SELECT id FROM schedule_departments WHERE tenant_id = ? AND name = ?").get(actor.tenant_id, name);
      if (!exists) {
        this.db.prepare(
          `INSERT INTO schedule_departments
           (id, tenant_id, name, description, color, active, display_order, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, name, description, color, displayOrder, actor.id || null, timestamp, timestamp);
      }
    }
    const views = [
      ["All Shop Schedules", "All permitted shop schedule entries", "#75638F", "all_shop", 10, { entry_types: ["event", "task", "appointment"], schedule_categories: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Production Schedule", "Production schedule entries", "#7B3DA6", "production", 20, { schedule_categories: ["production"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Installation Schedule", "Installation schedule entries", "#3F7FC4", "installation", 30, { schedule_categories: ["installation"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Sales Schedule", "Sales schedule entries", "#E06F00", "sales", 40, { schedule_categories: ["sales"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Customer Appointments", "Customer-facing appointments", "#E06F00", "customer_appointments", 50, { schedule_categories: ["customer_appointment", "site_survey"], entry_types: ["appointment"], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Pickup & Delivery Schedule", "Pickup and delivery schedule entries", "#b591cc", "pickup_delivery", 60, { schedule_categories: ["pickup", "delivery"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
    ];
    for (const [name, description, color, systemKey, displayOrder, filters] of views) {
      const exists = this.db.prepare("SELECT id FROM schedule_views WHERE tenant_id = ? AND system_key = ?").get(actor.tenant_id, systemKey);
      if (!exists) {
        this.db.prepare(
          `INSERT INTO schedule_views
           (id, tenant_id, owner_user_id, name, description, color, visibility, system_key, active, display_order, filters_json, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, 'shared', ?, 1, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, name, description, color, systemKey, displayOrder, JSON.stringify(filters), actor.id || null, timestamp, timestamp);
      }
    }
  }

  department(actor, id) {
    const row = this.db.prepare("SELECT * FROM schedule_departments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("department_not_found", 404);
    const memberships = this.db
      .prepare(
        `SELECT dm.*, u.display_name, u.email, u.role, u.active AS user_active
         FROM department_memberships dm
         JOIN users u ON u.id = dm.user_id AND u.tenant_id = dm.tenant_id
         WHERE dm.department_id = ? AND dm.tenant_id = ?
         ORDER BY dm.primary_department DESC, u.display_name`,
      )
      .all(id, actor.tenant_id)
      .map((membership) => inflateBool({
        id: membership.id,
        user_id: membership.user_id,
        display_name: membership.display_name,
        email: membership.email,
        role: membership.role,
        user_active: membership.user_active,
        primary_department: membership.primary_department,
        active: membership.active,
      }, ["user_active", "primary_department", "active"]));
    return mapDepartment(row, memberships);
  }

  listDepartments(actor) {
    this.ensureSchedulingDefaults(actor);
    return {
      items: this.db
        .prepare("SELECT * FROM schedule_departments WHERE tenant_id = ? ORDER BY display_order, name")
        .all(actor.tenant_id)
        .map((row) => this.department(actor, row.id)),
      users: this.users(actor).filter((user) => user.active),
    };
  }

  validateDepartmentId(actor, id, { allowInactive = false } = {}) {
    if (!id) return null;
    const row = this.db.prepare("SELECT id, active FROM schedule_departments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("department_not_found", 404);
    if (!allowInactive && !row.active) throw error("department_inactive", 400);
    return id;
  }

  saveDepartmentMemberships(actor, departmentId, memberships = []) {
    const seen = new Set();
    const timestamp = now();
    for (const membership of memberships) {
      if (seen.has(membership.user_id)) throw error("duplicate_department_membership", 400);
      seen.add(membership.user_id);
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(membership.user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (membership.primary_department && membership.active) {
        this.db.prepare(
          "UPDATE department_memberships SET primary_department = 0, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND department_id <> ?",
        ).run(timestamp, actor.tenant_id, membership.user_id, departmentId);
      }
      const existing = this.db.prepare("SELECT id FROM department_memberships WHERE tenant_id = ? AND department_id = ? AND user_id = ?").get(actor.tenant_id, departmentId, membership.user_id);
      if (existing) {
        this.db.prepare("UPDATE department_memberships SET primary_department = ?, active = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(bool(membership.primary_department), bool(membership.active), timestamp, existing.id, actor.tenant_id);
      } else {
        this.db.prepare(
          `INSERT INTO department_memberships (id, tenant_id, department_id, user_id, primary_department, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, departmentId, membership.user_id, bool(membership.primary_department), bool(membership.active), timestamp, timestamp);
      }
    }
    this.db.prepare(`UPDATE department_memberships SET active = 0, updated_at = ? WHERE tenant_id = ? AND department_id = ? AND user_id NOT IN (${memberships.map(() => "?").join(",") || "''"})`).run(timestamp, actor.tenant_id, departmentId, ...memberships.map((membership) => membership.user_id));
  }

  createDepartment(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = departmentSchema.parse(payload);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedule_departments
         (id, tenant_id, name, description, color, active, display_order, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.name, input.description || null, input.color, bool(input.active), input.display_order ?? 100, actor.id, timestamp, timestamp);
      this.saveDepartmentMemberships(actor, id, input.memberships || []);
      const department = this.department(actor, id);
      this.audit(actor, "schedule.department_create", "schedule_department", id, id, `Department ${input.name} created`, { memberships: department.memberships.length });
      return department;
    });
  }

  updateDepartment(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const existing = this.department(actor, id);
    const input = departmentSchema.parse({ ...existing, ...payload, memberships: payload.memberships ?? existing.memberships });
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedule_departments
         SET name = ?, description = ?, color = ?, active = ?, display_order = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.name, input.description || null, input.color, bool(input.active), input.display_order ?? existing.display_order, timestamp, id, actor.tenant_id);
      if (payload.memberships) this.saveDepartmentMemberships(actor, id, input.memberships);
      const warnings = this.departmentDeactivateWarnings(actor, id);
      this.audit(actor, "schedule.department_update", "schedule_department", id, id, `Department ${input.name} updated`, { active: input.active, warnings });
      return { ...this.department(actor, id), warnings };
    });
  }

  departmentDeactivateWarnings(actor, id) {
    const future = todayInTimeZone(this.tenantTimezone(actor));
    return {
      active_employees: this.db.prepare("SELECT COUNT(*) AS count FROM department_memberships WHERE tenant_id = ? AND department_id = ? AND active = 1").get(actor.tenant_id, id).count,
      future_entries: this.db.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE tenant_id = ? AND department_id = ? AND start_at >= ? AND status = 'scheduled'").get(actor.tenant_id, id, future).count,
      active_resources: this.db.prepare("SELECT COUNT(*) AS count FROM schedulable_resources WHERE tenant_id = ? AND department_id = ? AND active = 1").get(actor.tenant_id, id).count,
      saved_views: this.db.prepare("SELECT COUNT(*) AS count FROM schedule_views WHERE tenant_id = ? AND active = 1 AND filters_json LIKE ?").get(actor.tenant_id, `%${id}%`).count,
    };
  }

  resource(actor, id) {
    const row = this.db
      .prepare(
        `SELECT r.*, d.name AS department_name
         FROM schedulable_resources r
         LEFT JOIN schedule_departments d ON d.id = r.department_id AND d.tenant_id = r.tenant_id
         WHERE r.id = ? AND r.tenant_id = ?`,
      )
      .get(id, actor.tenant_id);
    if (!row) throw error("resource_not_found", 404);
    const unavailable = this.db.prepare("SELECT * FROM resource_unavailability WHERE tenant_id = ? AND resource_id = ? ORDER BY start_at").all(actor.tenant_id, id).map((entry) => inflateBool(entry, ["hard_block"]));
    return mapResource(row, unavailable);
  }

  listResources(actor) {
    return {
      items: this.db
        .prepare("SELECT id FROM schedulable_resources WHERE tenant_id = ? ORDER BY active DESC, name")
        .all(actor.tenant_id)
        .map((row) => this.resource(actor, row.id)),
      departments: this.listDepartments(actor).items,
    };
  }

  saveResourceUnavailable(actor, resourceId, unavailable = []) {
    const timestamp = now();
    this.db.prepare("DELETE FROM resource_unavailability WHERE tenant_id = ? AND resource_id = ?").run(actor.tenant_id, resourceId);
    for (const entry of unavailable) {
      const range = this.validateCalendarRange({ start_at: entry.start_at, end_at: entry.end_at, all_day: false }, actor);
      this.db.prepare(
        `INSERT INTO resource_unavailability
         (id, tenant_id, resource_id, start_at, end_at, reason, hard_block, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, resourceId, range.start_at, range.end_at, entry.reason || "Unavailable", bool(entry.hard_block), actor.id, timestamp, timestamp);
    }
  }

  createResource(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = resourceSchema.parse(payload);
    if (input.department_id) this.validateDepartmentId(actor, input.department_id);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedulable_resources
         (id, tenant_id, department_id, name, resource_type, description, capacity, color, active, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.department_id || null, input.name, input.resource_type, input.description || null, input.capacity, input.color, bool(input.active), actor.id, timestamp, timestamp);
      this.saveResourceUnavailable(actor, id, input.unavailable || []);
      this.audit(actor, "schedule.resource_create", "schedulable_resource", id, id, `Resource ${input.name} created`, { resource_type: input.resource_type, capacity: input.capacity });
      return this.resource(actor, id);
    });
  }

  updateResource(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const existing = this.resource(actor, id);
    const input = resourceSchema.parse({ ...existing, ...payload, unavailable: payload.unavailable ?? existing.unavailable });
    if (input.department_id) this.validateDepartmentId(actor, input.department_id, { allowInactive: true });
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedulable_resources
         SET department_id = ?, name = ?, resource_type = ?, description = ?, capacity = ?, color = ?, active = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.department_id || null, input.name, input.resource_type, input.description || null, input.capacity, input.color, bool(input.active), timestamp, id, actor.tenant_id);
      if (payload.unavailable) this.saveResourceUnavailable(actor, id, input.unavailable);
      this.audit(actor, "schedule.resource_update", "schedulable_resource", id, id, `Resource ${input.name} updated`, { active: input.active, capacity: input.capacity });
      return this.resource(actor, id);
    });
  }

  scheduleView(actor, id) {
    this.ensureSchedulingDefaults(actor);
    const row = this.db.prepare("SELECT * FROM schedule_views WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("schedule_view_not_found", 404);
    if (row.visibility === "personal" && row.owner_user_id !== actor.id) throw error("permission_denied", 403);
    return mapScheduleView(row);
  }

  listScheduleViews(actor) {
    this.ensureSchedulingDefaults(actor);
    const clauses = ["tenant_id = ?", "(visibility = 'shared' OR owner_user_id = ?)"];
    const rows = this.db.prepare(`SELECT * FROM schedule_views WHERE ${clauses.join(" AND ")} ORDER BY visibility, display_order, name`).all(actor.tenant_id, actor.id);
    return { items: rows.map(mapScheduleView), can_manage_shared: MANAGER_ROLES.has(actor.role) };
  }

  validateScheduleViewFilters(actor, filters) {
    const input = scheduleViewFiltersSchema.parse(filters || {});
    for (const id of input.department_ids) this.validateDepartmentId(actor, id, { allowInactive: true });
    for (const id of input.employee_ids) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
    }
    for (const id of input.resource_ids) {
      const resource = this.db.prepare("SELECT id FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
    }
    return input;
  }

  createScheduleView(actor, payload) {
    const input = scheduleViewSchema.parse(payload);
    if (input.visibility === "shared") this.requireRole(actor, MANAGER_ROLES);
    const filters = this.validateScheduleViewFilters(actor, input.filters);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedule_views
         (id, tenant_id, owner_user_id, name, description, color, visibility, system_key, active, display_order, filters_json, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.visibility === "personal" ? actor.id : null, input.name, input.description || null, input.color, input.visibility, bool(input.active), input.display_order ?? 100, JSON.stringify(filters), actor.id, timestamp, timestamp);
      this.audit(actor, "schedule.view_create", "schedule_view", id, id, `Schedule view ${input.name} created`, { visibility: input.visibility });
      return this.scheduleView(actor, id);
    });
  }

  updateScheduleView(actor, id, payload) {
    const existing = this.scheduleView(actor, id);
    if (existing.visibility === "shared") this.requireRole(actor, MANAGER_ROLES);
    if (existing.visibility === "personal" && existing.owner_user_id !== actor.id) throw error("permission_denied", 403);
    if (existing.system_key && Object.keys(payload).some((key) => key !== "active" || payload.active === false)) throw error("system_view_protected", 400);
    const input = scheduleViewSchema.parse({
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      color: payload.color ?? existing.color,
      visibility: payload.visibility ?? existing.visibility,
      active: payload.active ?? existing.active,
      display_order: payload.display_order ?? existing.display_order,
      filters: payload.filters ?? existing.filters,
    });
    if (input.visibility !== existing.visibility) throw error("invalid_schedule_view_visibility", 400);
    const filters = this.validateScheduleViewFilters(actor, input.filters);
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedule_views
         SET name = ?, description = ?, color = ?, active = ?, display_order = ?, filters_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.name, input.description || null, input.color, bool(input.active), input.display_order ?? existing.display_order, JSON.stringify(filters), timestamp, id, actor.tenant_id);
      this.audit(actor, "schedule.view_update", "schedule_view", id, id, `Schedule view ${input.name} updated`, { active: input.active });
      return this.scheduleView(actor, id);
    });
  }

  validateCalendarRange(input, actor) {
    if (input.all_day) {
      if (!dateOnly(input.start_at) || !dateOnly(input.end_at)) throw error("invalid_calendar_date", 400);
      if (input.end_at <= input.start_at) throw error("invalid_calendar_range", 400);
      return { start_at: input.start_at, end_at: input.end_at };
    }
    const timezone = this.tenantTimezone(actor);
    const startAt = normalizeTimedDateTime(input.start_at, timezone);
    const endAt = normalizeTimedDateTime(input.end_at, timezone);
    if (endAt <= startAt) throw error("invalid_calendar_range", 400);
    return { start_at: startAt, end_at: endAt };
  }

  validateCalendarLinks(actor, input) {
    const linked = { estimate_id: input.estimate_id || null, order_id: input.order_id || null, order_item_id: input.order_item_id || null, work_order_id: input.work_order_id || null };
    if (linked.estimate_id) {
      const estimate = this.db.prepare("SELECT id FROM estimates WHERE id = ? AND tenant_id = ?").get(linked.estimate_id, actor.tenant_id);
      if (!estimate) throw error("calendar_link_not_found", 404);
    }
    if (linked.order_id) {
      const order = this.db.prepare("SELECT id FROM orders WHERE id = ? AND tenant_id = ?").get(linked.order_id, actor.tenant_id);
      if (!order) throw error("calendar_link_not_found", 404);
    }
    if (linked.order_item_id) {
      const itemRow = this.db.prepare("SELECT id, order_id FROM order_items WHERE id = ? AND tenant_id = ?").get(linked.order_item_id, actor.tenant_id);
      if (!itemRow) throw error("calendar_link_not_found", 404);
      if (linked.order_id && itemRow.order_id !== linked.order_id) throw error("invalid_calendar_link", 400);
      linked.order_id = linked.order_id || itemRow.order_id;
    }
    if (linked.work_order_id) {
      const workOrder = this.db.prepare("SELECT id, order_id FROM work_orders WHERE id = ? AND tenant_id = ? AND status = 'active'").get(linked.work_order_id, actor.tenant_id);
      if (!workOrder) throw error("calendar_link_not_found", 404);
      if (linked.order_id && workOrder.order_id !== linked.order_id) throw error("invalid_calendar_link", 400);
      linked.order_id = linked.order_id || workOrder.order_id;
      if (linked.order_item_id) {
        const member = this.db.prepare("SELECT id FROM work_order_items WHERE tenant_id = ? AND work_order_id = ? AND order_item_id = ? AND active = 1").get(actor.tenant_id, linked.work_order_id, linked.order_item_id);
        if (!member) throw error("invalid_calendar_link", 400);
      }
    }
    if (input.assigned_user_id) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(input.assigned_user_id, actor.tenant_id);
      if (!user) throw error("calendar_assigned_user_not_found", 404);
    }
    return linked;
  }

  normalizeCalendarAssignees(actor, input) {
    const ids = new Set([...(input.assignee_user_ids || []), input.assigned_user_id, input.primary_assignee_user_id].filter(Boolean));
    const assigneeIds = [...ids];
    for (const id of assigneeIds) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(id, actor.tenant_id);
      if (!user) throw error("calendar_assigned_user_not_found", 404);
    }
    const primary = input.primary_assignee_user_id || input.assigned_user_id || assigneeIds[0] || null;
    return { assigneeIds, primary };
  }

  validateCalendarResources(actor, reservations = []) {
    const seen = new Set();
    return reservations.map((reservation) => {
      if (seen.has(reservation.resource_id)) throw error("duplicate_resource_reservation", 400);
      seen.add(reservation.resource_id);
      const resource = this.db.prepare("SELECT id, name, capacity, active FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(reservation.resource_id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
      if (!resource.active) throw error("resource_inactive", 400);
      if (reservation.quantity > resource.capacity) throw error("resource_capacity_exceeded", 400);
      return { ...reservation, resource };
    });
  }

  validateCalendarFilterReferences(actor, filters) {
    for (const category of filters.schedule_categories || []) {
      if (!SCHEDULE_CATEGORIES.includes(category)) throw error("invalid_calendar_filter", 400);
    }
    for (const id of filters.department_ids || []) this.validateDepartmentId(actor, id, { allowInactive: true });
    for (const id of filters.resource_ids || []) {
      const resource = this.db.prepare("SELECT id FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
    }
    for (const id of filters.employee_ids || []) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (!MANAGER_ROLES.has(actor.role) && id !== actor.id) throw error("permission_denied", 403);
    }
    if (filters.assigned_user_id && !["all", "unassigned"].includes(filters.assigned_user_id)) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(filters.assigned_user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (!MANAGER_ROLES.has(actor.role) && filters.assigned_user_id !== actor.id) throw error("permission_denied", 403);
    }
    if (filters.estimate_id) {
      const estimate = this.db.prepare("SELECT id FROM estimates WHERE id = ? AND tenant_id = ?").get(filters.estimate_id, actor.tenant_id);
      if (!estimate) throw error("calendar_link_not_found", 404);
    }
    if (filters.order_id) {
      const order = this.db.prepare("SELECT id FROM orders WHERE id = ? AND tenant_id = ?").get(filters.order_id, actor.tenant_id);
      if (!order) throw error("calendar_link_not_found", 404);
    }
    if (filters.order_item_id) {
      const item = this.db.prepare("SELECT id FROM order_items WHERE id = ? AND tenant_id = ?").get(filters.order_item_id, actor.tenant_id);
      if (!item) throw error("calendar_link_not_found", 404);
    }
    if (filters.work_order_id) {
      const workOrder = this.db.prepare("SELECT id FROM work_orders WHERE id = ? AND tenant_id = ?").get(filters.work_order_id, actor.tenant_id);
      if (!workOrder) throw error("calendar_link_not_found", 404);
    }
  }

  calendarScheduleDetails(actor, id) {
    const assignees = this.db
      .prepare(
        `SELECT cea.user_id, cea.primary_assignee, u.display_name, u.email, u.role
         FROM calendar_event_assignees cea
         JOIN users u ON u.id = cea.user_id AND u.tenant_id = cea.tenant_id
         WHERE cea.tenant_id = ? AND cea.calendar_event_id = ?
         ORDER BY cea.primary_assignee DESC, u.display_name`,
      )
      .all(actor.tenant_id, id)
      .map((row) => inflateBool(row, ["primary_assignee"]));
    const resources = this.db
      .prepare(
        `SELECT cer.resource_id, cer.quantity, r.name, r.resource_type, r.color, r.capacity
         FROM calendar_event_resource_reservations cer
         JOIN schedulable_resources r ON r.id = cer.resource_id AND r.tenant_id = cer.tenant_id
         WHERE cer.tenant_id = ? AND cer.calendar_event_id = ?
         ORDER BY r.name`,
      )
      .all(actor.tenant_id, id);
    return { assignees, resource_reservations: resources };
  }

  attachCalendarScheduleDetails(actor, event) {
    if (!event || event.derived) return event;
    const details = this.calendarScheduleDetails(actor, event.id);
    if (!details.assignees.length && event.assigned_user_id) {
      details.assignees.push({ user_id: event.assigned_user_id, primary_assignee: true, display_name: event.assigned_user_name });
    }
    return { ...event, ...details };
  }

  writeCalendarAssignees(actor, eventId, assignees) {
    const timestamp = now();
    this.db.prepare("DELETE FROM calendar_event_assignees WHERE tenant_id = ? AND calendar_event_id = ?").run(actor.tenant_id, eventId);
    for (const userId of assignees.assigneeIds) {
      this.db.prepare(
        `INSERT INTO calendar_event_assignees (id, tenant_id, calendar_event_id, user_id, primary_assignee, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, eventId, userId, bool(userId === assignees.primary), timestamp);
    }
  }

  writeCalendarResources(actor, eventId, reservations = []) {
    const timestamp = now();
    this.db.prepare("DELETE FROM calendar_event_resource_reservations WHERE tenant_id = ? AND calendar_event_id = ?").run(actor.tenant_id, eventId);
    for (const reservation of reservations) {
      this.db.prepare(
        `INSERT INTO calendar_event_resource_reservations (id, tenant_id, calendar_event_id, resource_id, quantity, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, eventId, reservation.resource_id, reservation.quantity || 1, timestamp);
    }
  }

  checkCalendarConflicts(actor, { id = null, range, assigneeIds = [], reservations = [] }) {
    const conflicts = [];
    for (const userId of assigneeIds) {
      const rows = this.db
        .prepare(
          `SELECT ce.id, ce.title, ce.start_at, ce.end_at, u.display_name
           FROM calendar_events ce
           JOIN calendar_event_assignees cea ON cea.calendar_event_id = ce.id AND cea.tenant_id = ce.tenant_id
           JOIN users u ON u.id = cea.user_id AND u.tenant_id = cea.tenant_id
           WHERE ce.tenant_id = ? AND cea.user_id = ? AND ce.status = 'scheduled' AND ce.id <> ? AND ce.start_at < ? AND ce.end_at > ?`,
        )
        .all(actor.tenant_id, userId, id || "", range.end_at, range.start_at);
      for (const row of rows) {
        conflicts.push({ type: "employee", user_id: userId, name: row.display_name, conflicting_entry_id: row.id, conflicting_title: row.title, start_at: row.start_at, end_at: row.end_at, reason: "employee_already_assigned", override_permitted: MANAGER_ROLES.has(actor.role) });
      }
    }
    for (const reservation of reservations) {
      const unavailable = this.db
        .prepare(
          `SELECT ru.*, r.name
           FROM resource_unavailability ru
           JOIN schedulable_resources r ON r.id = ru.resource_id AND r.tenant_id = ru.tenant_id
           WHERE ru.tenant_id = ? AND ru.resource_id = ? AND ru.start_at < ? AND ru.end_at > ?`,
        )
        .all(actor.tenant_id, reservation.resource_id, range.end_at, range.start_at);
      for (const row of unavailable) {
        conflicts.push({ type: "resource", resource_id: reservation.resource_id, name: row.name, conflicting_entry_id: null, start_at: row.start_at, end_at: row.end_at, reason: row.reason || "resource_unavailable", override_permitted: MANAGER_ROLES.has(actor.role), hard_block: Boolean(row.hard_block) });
      }
      const usage = this.db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN ce.id IS NOT NULL THEN cer.quantity ELSE 0 END), 0) AS quantity, r.capacity, r.name
           FROM schedulable_resources r
           LEFT JOIN calendar_event_resource_reservations cer ON cer.resource_id = r.id AND cer.tenant_id = r.tenant_id
           LEFT JOIN calendar_events ce ON ce.id = cer.calendar_event_id AND ce.tenant_id = cer.tenant_id AND ce.status = 'scheduled' AND ce.id <> ? AND ce.start_at < ? AND ce.end_at > ?
           WHERE r.id = ? AND r.tenant_id = ?
           GROUP BY r.id`,
        )
        .get(id || "", range.end_at, range.start_at, reservation.resource_id, actor.tenant_id);
      if (usage && Number(usage.quantity || 0) + reservation.quantity > usage.capacity) {
        conflicts.push({ type: "resource", resource_id: reservation.resource_id, name: usage.name, conflicting_entry_id: null, start_at: range.start_at, end_at: range.end_at, reason: "resource_capacity_exceeded", override_permitted: MANAGER_ROLES.has(actor.role), hard_block: true });
      }
    }
    return conflicts;
  }

  enforceCalendarConflicts(actor, input, range, assignees, resources, existingId = null) {
    const conflicts = this.checkCalendarConflicts(actor, { id: existingId, range, assigneeIds: assignees.assigneeIds, reservations: resources });
    if (!conflicts.length) return [];
    if (!input.conflict_override) {
      const err = error("schedule_conflict", 409);
      err.conflicts = conflicts;
      throw err;
    }
    if (!MANAGER_ROLES.has(actor.role)) throw error("permission_denied", 403);
    const reason = String(input.conflict_override_reason || "").trim();
    if (reason.length < 5) throw error("conflict_override_reason_required", 400);
    return { conflicts, reason };
  }

  applyScheduleViewFilters(actor, filters) {
    this.ensureSchedulingDefaults(actor);
    const next = { ...filters };
    if (next.view_id) {
      const view = this.scheduleView(actor, next.view_id);
      Object.assign(next, {
        schedule_categories: view.filters.schedule_categories,
        entry_types: view.filters.entry_types,
        department_ids: view.filters.department_ids,
        employee_ids: view.filters.employee_ids,
        resource_ids: view.filters.resource_ids,
        statuses: view.filters.statuses,
        linked_state: view.filters.linked,
        selected_view: view,
      });
    }
    if (next.my_schedule === "1" || next.my_schedule === "true" || next.my_schedule === true) {
      next.my_schedule = true;
      next.selected_view = { id: "my_schedule", name: "My Schedule", color: "#255b73", filters: {} };
    }
    next.schedule_categories = listParam(next.schedule_categories || next.schedule_category);
    next.entry_types = listParam(next.entry_types || next.entry_type).filter((type) => type !== "all");
    next.department_ids = listParam(next.department_ids || next.department_id);
    next.employee_ids = listParam(next.employee_ids || next.employee_id || next.assigned_user_id).filter((id) => id !== "unassigned");
    next.resource_ids = listParam(next.resource_ids || next.resource_id);
    next.statuses = listParam(next.statuses || next.status).filter((status) => status !== "all");
    return next;
  }

  calendarEvent(actor, id) {
    const tenant = this.tenant(actor.tenant_id);
    const row = this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, e.estimate_number,
                o.order_number, o.title AS order_title, oi.title AS item_title, oi.description AS item_description,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN estimates e ON e.id = ce.estimate_id AND e.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN order_items oi ON oi.id = ce.order_item_id AND oi.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ce.id = ? AND ce.tenant_id = ?`,
      )
      .get(id, actor.tenant_id);
    if (!row) throw error("calendar_event_not_found", 404);
    return this.attachCalendarScheduleDetails(actor, mapCalendarEvent(row, tenant));
  }

  listCalendarEvents(actor, filters = {}) {
    filters = this.applyScheduleViewFilters(actor, filters);
    const tenant = this.tenant(actor.tenant_id);
    const start = filters.start_at || filters.start || addDays(todayInTimeZone(tenant.shop_timezone), -31);
    const end = filters.end_at || filters.end || addDays(todayInTimeZone(tenant.shop_timezone), 62);
    if (!String(start).trim() || !String(end).trim() || String(end) <= String(start)) throw error("invalid_calendar_range", 400);
    if (filters.status && filters.status !== "all" && !CALENDAR_STATUSES.includes(filters.status)) throw error("invalid_calendar_status", 400);
    for (const status of filters.statuses || []) if (!CALENDAR_STATUSES.includes(status)) throw error("invalid_calendar_status", 400);
    if (filters.entry_type && filters.entry_type !== "all" && !CALENDAR_FEED_TYPES.includes(filters.entry_type)) throw error("invalid_calendar_filter", 400);
    for (const type of filters.entry_types || []) if (!CALENDAR_FEED_TYPES.includes(type)) throw error("invalid_calendar_filter", 400);
    if (filters.linked_record_type && !LINKED_RECORD_TYPES.includes(filters.linked_record_type)) throw error("invalid_calendar_filter", 400);
    this.validateCalendarFilterReferences(actor, filters);
    const clauses = ["ce.tenant_id = ?", "ce.start_at < ?", "ce.end_at > ?"];
    const values = [actor.tenant_id, end, start];
    if (filters.status && filters.status !== "all") {
      clauses.push("ce.status = ?");
      values.push(filters.status);
    }
    if (filters.statuses?.length) {
      clauses.push(`ce.status IN (${filters.statuses.map(() => "?").join(",")})`);
      values.push(...filters.statuses);
    }
    if (filters.entry_type && filters.entry_type !== "all" && CALENDAR_ENTRY_TYPES.includes(filters.entry_type)) {
      clauses.push("ce.entry_type = ?");
      values.push(filters.entry_type);
    }
    if (filters.entry_types?.length && filters.entry_types.every((type) => CALENDAR_ENTRY_TYPES.includes(type))) {
      clauses.push(`ce.entry_type IN (${filters.entry_types.map(() => "?").join(",")})`);
      values.push(...filters.entry_types);
    } else if (filters.entry_types?.some((type) => ["production", "deadline"].includes(type)) && !filters.entry_types.some((type) => CALENDAR_ENTRY_TYPES.includes(type))) {
      clauses.push("1 = 0");
    }
    if (["production", "deadline"].includes(filters.entry_type)) clauses.push("1 = 0");
    if (filters.schedule_categories?.length) {
      clauses.push(`ce.schedule_category IN (${filters.schedule_categories.map(() => "?").join(",")})`);
      values.push(...filters.schedule_categories);
    }
    if (filters.department_ids?.length) {
      clauses.push(`ce.department_id IN (${filters.department_ids.map(() => "?").join(",")})`);
      values.push(...filters.department_ids);
    }
    if (filters.assigned_user_id && filters.assigned_user_id !== "all") {
      if (filters.assigned_user_id === "unassigned") clauses.push("ce.assigned_user_id IS NULL");
      else {
        clauses.push("(ce.assigned_user_id = ? OR EXISTS (SELECT 1 FROM calendar_event_assignees cea_filter WHERE cea_filter.calendar_event_id = ce.id AND cea_filter.tenant_id = ce.tenant_id AND cea_filter.user_id = ?))");
        values.push(filters.assigned_user_id);
        values.push(filters.assigned_user_id);
      }
    }
    if (filters.employee_ids?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM calendar_event_assignees cea_employee WHERE cea_employee.calendar_event_id = ce.id AND cea_employee.tenant_id = ce.tenant_id AND cea_employee.user_id IN (${filters.employee_ids.map(() => "?").join(",")}))`);
      values.push(...filters.employee_ids);
    }
    if (filters.resource_ids?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM calendar_event_resource_reservations cer_filter WHERE cer_filter.calendar_event_id = ce.id AND cer_filter.tenant_id = ce.tenant_id AND cer_filter.resource_id IN (${filters.resource_ids.map(() => "?").join(",")}))`);
      values.push(...filters.resource_ids);
    }
    if (filters.my_schedule) {
      clauses.push(`(
        EXISTS (SELECT 1 FROM calendar_event_assignees cea_me WHERE cea_me.calendar_event_id = ce.id AND cea_me.tenant_id = ce.tenant_id AND cea_me.user_id = ?)
        OR ce.assigned_user_id = ?
        OR EXISTS (
          SELECT 1 FROM department_memberships dm_me
          WHERE dm_me.tenant_id = ce.tenant_id AND dm_me.department_id = ce.department_id AND dm_me.user_id = ? AND dm_me.active = 1
        )
      )`);
      values.push(actor.id, actor.id, actor.id);
    }
    if (filters.order_id) {
      clauses.push("ce.order_id = ?");
      values.push(filters.order_id);
    }
    if (filters.order_item_id) {
      clauses.push("ce.order_item_id = ?");
      values.push(filters.order_item_id);
    }
    if (filters.work_order_id) {
      clauses.push("ce.work_order_id = ?");
      values.push(filters.work_order_id);
    }
    if (filters.estimate_id) {
      clauses.push("ce.estimate_id = ?");
      values.push(filters.estimate_id);
    }
    if (filters.linked_record_type === "none") clauses.push("ce.estimate_id IS NULL AND ce.order_id IS NULL AND ce.order_item_id IS NULL AND ce.work_order_id IS NULL");
    if (filters.linked_record_type === "estimate") clauses.push("ce.estimate_id IS NOT NULL");
    if (filters.linked_record_type === "order") clauses.push("ce.order_id IS NOT NULL AND ce.order_item_id IS NULL");
    if (filters.linked_record_type === "order_item") clauses.push("ce.order_item_id IS NOT NULL");
    if (filters.linked_record_type === "work_order") clauses.push("ce.work_order_id IS NOT NULL");
    if (filters.linked_state === "linked") clauses.push("(ce.estimate_id IS NOT NULL OR ce.order_id IS NOT NULL OR ce.order_item_id IS NOT NULL OR ce.work_order_id IS NOT NULL)");
    if (filters.linked_state === "unlinked") clauses.push("ce.estimate_id IS NULL AND ce.order_id IS NULL AND ce.order_item_id IS NULL AND ce.work_order_id IS NULL");
    const rows = this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, e.estimate_number,
                o.order_number, o.title AS order_title, oi.title AS item_title, oi.description AS item_description,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN estimates e ON e.id = ce.estimate_id AND e.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN order_items oi ON oi.id = ce.order_item_id AND oi.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY ce.start_at, ce.title`,
      )
      .all(...values)
      .map((row) => this.attachCalendarScheduleDetails(actor, mapCalendarEvent(row, tenant)));
    const derived = this.derivedCalendarEntries(actor, { ...filters, start_at: start, end_at: end }, tenant);
    return {
      items: [...rows, ...derived].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)) || String(a.title).localeCompare(String(b.title))),
      users: this.users(actor).filter((user) => user.active),
      departments: this.listDepartments(actor).items,
      resources: this.listResources(actor).items,
      views: this.listScheduleViews(actor).items.filter((view) => view.active),
      selected_view: filters.selected_view || null,
      can_manage_schedule: MANAGER_ROLES.has(actor.role),
      timezone: tenant.shop_timezone,
    };
  }

  derivedCalendarEntries(actor, filters, tenant) {
    if (filters.status && !["all", "scheduled"].includes(filters.status)) return [];
    const start = filters.start_at;
    const end = filters.end_at;
    const linked = filters.linked_record_type || "all";
    const type = filters.entry_type || "all";
    const assigned = filters.assigned_user_id || "all";
    const entryTypes = filters.entry_types || [];
    const includeDeadline = ["all", "deadline"].includes(type) && (!entryTypes.length || entryTypes.includes("deadline"));
    const includeProduction = ["all", "production"].includes(type) && (!entryTypes.length || entryTypes.includes("production"));
    const rows = [];
    const matchesLinked = (recordType) => linked === "all" || linked === recordType;
    const matchesDate = (date) => date && date >= start && date < end;
    const matchesCategory = (category) => !filters.schedule_categories?.length || filters.schedule_categories.includes(category);
    const base = (overrides) => mapCalendarEvent({
      portable_id: null,
      tenant_id: actor.tenant_id,
      end_at: addDays(overrides.start_at, 1),
      all_day: 1,
      assigned_user_id: null,
      status: "scheduled",
      internal_note: null,
      created_by_user_id: null,
      created_at: null,
      updated_at: null,
      assigned_user_name: null,
      source_type: overrides.source_type,
      entry_type: overrides.source_type,
      derived: true,
      ...overrides,
    }, tenant);

    if (includeDeadline && matchesCategory("deadline") && matchesLinked("order") && assigned === "all" && !filters.order_item_id && !filters.estimate_id) {
      const orderRows = this.db
        .prepare(
          `SELECT o.id, o.order_number, o.due_date, c.contact_name, c.business_name
           FROM orders o
           JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
           WHERE o.tenant_id = ? AND o.due_date IS NOT NULL AND o.status NOT IN ('complete', 'cancelled')`,
        )
        .all(actor.tenant_id);
      for (const row of orderRows.filter((row) => matchesDate(row.due_date) && (!filters.order_id || filters.order_id === row.id))) {
        rows.push(base({
          id: `derived-order-due-${row.id}`,
          source_type: "deadline",
          title: `Order due: ${row.order_number}`,
          start_at: row.due_date,
          order_id: row.id,
          order_item_id: null,
          order_number: row.order_number,
          customer_name: row.business_name || row.contact_name,
        }));
      }
    }

    if ((includeDeadline || includeProduction) && matchesLinked("order_item") && !filters.estimate_id) {
      const itemRows = this.db
        .prepare(
          `SELECT oi.id, oi.order_id, oi.description, oi.due_date, oi.assigned_user_id, oi.production_required, oi.completed, o.order_number, u.display_name AS assigned_user_name
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
           LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = ? AND oi.due_date IS NOT NULL AND o.status NOT IN ('complete', 'cancelled')`,
        )
        .all(actor.tenant_id);
      for (const row of itemRows) {
        if (!matchesDate(row.due_date)) continue;
        if (filters.order_id && filters.order_id !== row.order_id) continue;
        if (filters.order_item_id && filters.order_item_id !== row.id) continue;
        if (assigned === "unassigned" && row.assigned_user_id) continue;
        if (assigned !== "all" && assigned !== "unassigned" && assigned !== row.assigned_user_id) continue;
        const sourceType = row.production_required && !row.completed ? "production" : "deadline";
        if ((sourceType === "production" && !includeProduction) || (sourceType === "deadline" && !includeDeadline)) continue;
        if (!matchesCategory(sourceType)) continue;
        rows.push(base({
          id: `derived-item-${sourceType}-${row.id}`,
          source_type: sourceType,
          title: `${sourceType === "production" ? "Production due" : "Item due"}: ${row.description}`,
          start_at: row.due_date,
          order_id: row.order_id,
          order_item_id: row.id,
          order_number: row.order_number,
          item_description: row.description,
          assigned_user_id: row.assigned_user_id,
          assigned_user_name: row.assigned_user_name,
        }));
      }
    }

    return rows;
  }

  createCalendarEvent(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = calendarEventSchema.parse(payload);
    const departmentId = this.validateDepartmentId(actor, input.department_id);
    const linked = this.validateCalendarLinks(actor, input);
    const range = this.validateCalendarRange(input, actor);
    const assignees = this.normalizeCalendarAssignees(actor, input);
    const resources = this.validateCalendarResources(actor, input.resource_reservations || []);
    return this.transaction(() => {
      const override = this.enforceCalendarConflicts(actor, input, range, assignees, resources);
      const conflicts = override.conflicts || [];
      const id = randomUUID();
      const pid = portable("calendar_event");
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO calendar_events
           (id, portable_id, tenant_id, entry_type, schedule_category, department_id, title, task_priority, appointment_type, customer_name, customer_contact, location, estimate_id, order_id, order_item_id, work_order_id, start_at, end_at, all_day, assigned_user_id, status, internal_note, conflict_override_reason, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, input.entry_type, input.schedule_category, departmentId, input.title, input.task_priority || null, input.appointment_type || null, input.customer_name || null, input.customer_contact || null, input.location || null, linked.estimate_id, linked.order_id, linked.order_item_id, linked.work_order_id, range.start_at, range.end_at, bool(input.all_day), assignees.primary, input.status || "scheduled", input.internal_note || null, conflicts.length ? override.reason : null, actor.id, timestamp, timestamp);
      this.writeCalendarAssignees(actor, id, assignees);
      this.writeCalendarResources(actor, id, resources);
      this.audit(actor, "calendar.create", "calendar_event", id, pid, `Calendar ${input.entry_type} ${input.title} scheduled`, { entry_type: input.entry_type, schedule_category: input.schedule_category, department_id: departmentId, estimate_id: linked.estimate_id, order_id: linked.order_id, order_item_id: linked.order_item_id, work_order_id: linked.work_order_id, assignee_user_ids: assignees.assigneeIds, resource_ids: resources.map((resource) => resource.resource_id), conflicts, conflict_override_reason: conflicts.length ? override.reason : null });
      return this.calendarEvent(actor, id);
    });
  }

  updateCalendarEvent(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.calendarEvent(actor, id);
    const input = calendarEventSchema.parse({ ...existing, ...payload });
    const departmentId = this.validateDepartmentId(actor, input.department_id, { allowInactive: true });
    const linked = this.validateCalendarLinks(actor, input);
    const range = this.validateCalendarRange(input, actor);
    const assignees = this.normalizeCalendarAssignees(actor, input);
    const resources = this.validateCalendarResources(actor, input.resource_reservations || []);
    return this.transaction(() => {
      const override = this.enforceCalendarConflicts(actor, input, range, assignees, resources, id);
      const conflicts = override.conflicts || [];
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE calendar_events
           SET entry_type = ?, schedule_category = ?, department_id = ?, title = ?, task_priority = ?, appointment_type = ?, customer_name = ?, customer_contact = ?, location = ?, estimate_id = ?, order_id = ?, order_item_id = ?, work_order_id = ?, start_at = ?, end_at = ?, all_day = ?, assigned_user_id = ?, status = ?, internal_note = ?, conflict_override_reason = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.entry_type, input.schedule_category, departmentId, input.title, input.task_priority || null, input.appointment_type || null, input.customer_name || null, input.customer_contact || null, input.location || null, linked.estimate_id, linked.order_id, linked.order_item_id, linked.work_order_id, range.start_at, range.end_at, bool(input.all_day), assignees.primary, input.status || existing.status, input.internal_note || null, conflicts.length ? override.reason : existing.conflict_override_reason || null, timestamp, id, actor.tenant_id);
      this.writeCalendarAssignees(actor, id, assignees);
      this.writeCalendarResources(actor, id, resources);
      const action = existing.start_at !== range.start_at || existing.end_at !== range.end_at ? "calendar.reschedule" : "calendar.update";
      this.audit(actor, action, "calendar_event", id, existing.portable_id, `Calendar ${input.entry_type} ${input.title} ${action === "calendar.reschedule" ? "rescheduled" : "updated"}`, { from: { start_at: existing.start_at, end_at: existing.end_at }, to: range, entry_type: input.entry_type, schedule_category: input.schedule_category, department_id: departmentId, assignee_user_ids: assignees.assigneeIds, resource_ids: resources.map((resource) => resource.resource_id), conflicts, conflict_override_reason: conflicts.length ? override.reason : null });
      return this.calendarEvent(actor, id);
    });
  }

  setCalendarStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!CALENDAR_STATUSES.includes(status)) throw error("invalid_calendar_status", 400);
    return this.transaction(() => {
      const existing = this.calendarEvent(actor, id);
      const timestamp = now();
      this.db.prepare("UPDATE calendar_events SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, timestamp, id, actor.tenant_id);
      const action = status === "complete" ? "calendar.complete" : status === "cancelled" ? "calendar.cancel" : "calendar.reopen";
      this.audit(actor, action, "calendar_event", id, existing.portable_id, `Calendar event ${existing.title} ${status}`, { from: existing.status, to: status });
      return this.calendarEvent(actor, id);
    });
  }

  dashboard(actor) {
    const tenant = this.tenant(actor.tenant_id);
    const todayLocal = todayInTimeZone(tenant.shop_timezone);
    const endLocal = addDays(todayLocal, 14);
    const board = this.productionBoard(actor);
    const stages = PRODUCTION_STAGES.map((stage) => {
      const stageItems = board.items.filter((item) => item.production_stage === stage && !["complete", "cancelled"].includes(item.order_status));
      return {
        stage,
        label: stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        count: stageItems.length,
        items: stageItems.slice(0, 3),
      };
    });
    const events = this.listCalendarEvents(actor, { start_at: todayLocal, end_at: endLocal, status: "scheduled" }).items;
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = addDays(todayLocal, index);
      return { date, today: index === 0, events: events.filter((event) => event.local_start_date === date) };
    });
    return {
      timezone: tenant.shop_timezone,
      production: { stages },
      calendar: { start_date: todayLocal, end_date: addDays(todayLocal, 13), days },
      attention: this.attentionItems(actor, todayLocal),
    };
  }

  attentionItems(actor, todayLocal = today()) {
    const seen = new Set();
    const items = [];
    const push = (entry) => {
      const key = `${entry.source_type}:${entry.source_id}:${entry.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(entry);
    };
    const severityFor = (date) => (date < todayLocal ? "overdue" : date === todayLocal ? "due today" : "reminder");
    this.db
      .prepare("SELECT id, order_number, due_date FROM orders WHERE tenant_id = ? AND due_date IS NOT NULL AND due_date <= ? AND status NOT IN ('complete', 'cancelled') ORDER BY due_date, order_number")
      .all(actor.tenant_id, todayLocal)
      .forEach((row) => push({ source_type: "order", source_id: row.id, reason: "order_due", title: row.order_number, date: row.due_date, severity: severityFor(row.due_date), link: `#/orders/${row.id}` }));
    this.db
      .prepare(
        `SELECT oi.id, oi.order_id, oi.description, COALESCE(oi.due_date, o.due_date) AS effective_due_date, o.order_number
         FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND oi.production_required = 1 AND oi.completed = 0 AND COALESCE(oi.due_date, o.due_date) IS NOT NULL AND COALESCE(oi.due_date, o.due_date) <= ? AND o.status NOT IN ('complete', 'cancelled')
         ORDER BY effective_due_date, o.order_number, oi.position`,
      )
      .all(actor.tenant_id, todayLocal)
      .forEach((row) => push({ source_type: "order_item", source_id: row.id, reason: "production_due", title: row.description, date: row.effective_due_date, severity: severityFor(row.effective_due_date), link: `#/orders/${row.order_id}` }));
    this.db
      .prepare("SELECT id, estimate_number, follow_up_at, expires_at FROM estimates WHERE tenant_id = ? AND status IN ('draft', 'sent') AND ((follow_up_at IS NOT NULL AND follow_up_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?)) ORDER BY COALESCE(follow_up_at, expires_at), estimate_number")
      .all(actor.tenant_id, todayLocal, todayLocal)
      .forEach((row) => {
        if (row.follow_up_at && row.follow_up_at <= todayLocal) push({ source_type: "estimate", source_id: row.id, reason: "estimate_follow_up", title: row.estimate_number, date: row.follow_up_at, severity: severityFor(row.follow_up_at), link: "#/estimates" });
        if (row.expires_at && row.expires_at <= todayLocal) push({ source_type: "estimate", source_id: row.id, reason: "estimate_expiration", title: row.estimate_number, date: row.expires_at, severity: severityFor(row.expires_at), link: "#/estimates" });
      });
    this.listCalendarEvents(actor, { start_at: addDays(todayLocal, -30), end_at: addDays(todayLocal, 1), status: "scheduled" }).items
      .filter((event) => event.local_start_date <= todayLocal)
      .forEach((event) => push({ source_type: "calendar_event", source_id: event.id, reason: "calendar_due", title: event.title, date: event.local_start_date, severity: event.local_start_date < todayLocal ? "overdue" : "due today", link: "#/calendar" }));
    this.db
      .prepare("SELECT id, invoice_number, due_date, balance_due_cents FROM invoices WHERE tenant_id = ? AND document_status = 'issued' AND balance_due_cents > 0 ORDER BY COALESCE(due_date, document_date), invoice_number")
      .all(actor.tenant_id)
      .forEach((row) => {
        const severity = row.due_date ? severityFor(row.due_date) : "payment attention";
        push({ source_type: "invoice", source_id: row.id, reason: "payment_attention", title: row.invoice_number, date: row.due_date, severity, link: "#/invoices", balance_due_cents: row.balance_due_cents });
      });
    return items;
  }

  updateOrderWorkspace(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = orderWorkspaceSchema.parse(payload);
    if (!Object.keys(input).filter((key) => key !== "expected_updated_at").length) throw error("no_updates");
    return this.transaction(() => {
      const existing = this.order(actor, id);
      if (input.expected_updated_at !== existing.updated_at) throw error("order_conflict", 409);
      const nextItems = input.items ? this.prepareWorkspaceItems(actor, input.items) : existing.items;
      if (input.items) this.assertPostReleaseItemChanges(actor, existing, nextItems);
      if (input.items) this.assertBundledItemChanges(actor, "order", id, existing.items, nextItems);
      if (existing.invoice && input.items) this.assertInvoicedFinancialLock(existing, nextItems, input.discount_cents);
      if (existing.invoice && input.discount_cents !== undefined && input.discount_cents !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
      const totals = input.items || input.discount_cents !== undefined
        ? documentTotals(nextItems, input.discount_cents ?? existing.discount_cents, existing.tax_rate_basis_points_snapshot, existing.customer_tax_exempt_snapshot)
        : null;
      const timestamp = now();
      const fields = [];
      const values = [];
      for (const key of ["document_date", "due_date", "status", "internal_notes"]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          fields.push(`${key} = ?`);
          values.push(input[key] ?? null);
        }
      }
      if (Object.prototype.hasOwnProperty.call(input, "title")) {
        fields.push("title = ?");
        values.push(normalizeTitle(input.title));
      }
      if (totals) {
        fields.push("subtotal_cents = ?", "discount_cents = ?", "tax_cents = ?", "total_cents = ?");
        values.push(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents);
      }
      fields.push("updated_at = ?");
      values.push(timestamp, id, actor.tenant_id, input.expected_updated_at);
      const result = this.db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ? AND updated_at = ?`).run(...values);
      if (result.changes !== 1) throw error("order_conflict", 409);
      if (input.items) {
        this.updateOrderItemsDifferential(actor, id, existing.items, nextItems, timestamp);
      }
      if (this.db.prepare("SELECT id FROM commercial_bundles WHERE tenant_id = ? AND document_type = 'order' AND document_id = ? AND active = 1 LIMIT 1").get(actor.tenant_id, id)) {
        this.recalculateDocumentTotalsForBundles(actor, "order", id);
        const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, id);
        if (invoice?.document_status === "draft") this.recalculateDocumentTotalsForBundles(actor, "invoice", invoice.id);
      }
      const updated = this.order(actor, id);
      this.audit(actor, "order.workspace_update", "order", id, updated.portable_id, `Order ${updated.order_number} workspace saved`, { fields: Object.keys(input).filter((key) => key !== "expected_updated_at") });
      return this.orderWorkspace(actor, id);
    });
  }

  workOrderRows(actor, orderId) {
    return this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name,
                COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.order_id = ? AND wo.status = 'active'
         GROUP BY wo.id
         ORDER BY wo.work_order_number`,
      )
      .all(actor.tenant_id, orderId);
  }

  workOrderItems(actor, workOrderId) {
    return this.db
      .prepare(
        `SELECT oi.*
         FROM work_order_items woi
         JOIN order_items oi ON oi.id = woi.order_item_id AND oi.tenant_id = woi.tenant_id
         WHERE woi.tenant_id = ? AND woi.work_order_id = ? AND woi.active = 1
         ORDER BY woi.position, oi.position`,
      )
      .all(actor.tenant_id, workOrderId)
      .map((row) => {
        const item = mapItem(row, "order_id");
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          production_required: item.production_required,
          production_stage: item.production_stage,
          completed: item.completed,
          due_date: item.due_date,
          assigned_user_id: item.assigned_user_id,
          internal_note: item.internal_note,
        };
      });
  }

  workOrderSchedules(actor, workOrderId) {
    const tenant = this.tenant(actor.tenant_id);
    return this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, o.order_number, o.title AS order_title,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ce.tenant_id = ? AND ce.work_order_id = ?
         ORDER BY ce.start_at`,
      )
      .all(actor.tenant_id, workOrderId)
      .map((row) => mapCalendarEvent(row, tenant));
  }

  workOrdersForOrder(actor, orderId) {
    this.order(actor, orderId);
    return this.workOrderRows(actor, orderId).map((row) => mapWorkOrder(row, this.workOrderItems(actor, row.id), this.workOrderSchedules(actor, row.id)));
  }

  workOrderSummary(actor, id) {
    const row = this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name,
                COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.id = ?
         GROUP BY wo.id`,
      )
      .get(actor.tenant_id, id);
    if (!row) throw error("work_order_not_found", 404);
    const summary = mapWorkOrder(row, this.workOrderItems(actor, id), this.workOrderSchedules(actor, id));
    return canViewFinancials(actor) ? summary : stripFinancialFields(summary);
  }

  normalizeProductionSetup(actor, order, payload) {
    const input = productionSetupSchema.parse(payload);
    const productionItems = order.items.filter((item) => item.production_required);
    if (!productionItems.length) throw error("production_items_required", 400);
    const byId = new Map(productionItems.map((item) => [item.id, item]));
    const groups = [];
    const seen = new Set();
    const seenGroupTitles = new Set();
    const addGroup = (title, ids, { enforceUniqueTitle = true } = {}) => {
      const cleanIds = ids.filter(Boolean);
      if (!cleanIds.length) throw error("production_group_empty", 400);
      const cleanTitle = normalizeTitle(title);
      if (!cleanTitle) throw error("production_group_title_required", 400);
      const titleKey = cleanTitle.toLowerCase();
      if (enforceUniqueTitle) {
        if (seenGroupTitles.has(titleKey)) throw error("production_group_title_duplicate", 400);
        seenGroupTitles.add(titleKey);
      }
      for (const id of cleanIds) {
        if (!byId.has(id)) throw error("production_item_not_found", 404);
        if (seen.has(id)) throw error("production_item_assigned_twice", 400);
        seen.add(id);
      }
      groups.push({ title: cleanTitle, item_ids: cleanIds });
    };
    if (input.mode === "whole_order") {
      addGroup(order.title, productionItems.map((item) => item.id));
    } else if (input.mode === "individual_items") {
      for (const item of productionItems) addGroup(item.title, [item.id], { enforceUniqueTitle: false });
    } else {
      for (const group of input.groups || []) addGroup(group.title, group.item_ids || []);
      for (const id of input.independent_item_ids || []) addGroup(byId.get(id)?.title || "Independent Item", [id]);
      if (seen.size !== productionItems.length) throw error("production_items_unassigned", 400);
    }
    if (seen.size !== productionItems.length) throw error("production_items_unassigned", 400);
    return { ...input, groups };
  }

  createWorkOrdersFromPlan(actor, order, plan, timestamp) {
    const orderItems = new Map(order.items.map((item) => [item.id, item]));
    const created = [];
    plan.groups.forEach((group) => {
      const groupItems = group.item_ids.map((id) => orderItems.get(id));
      const id = randomUUID();
      const pid = portable("work_order");
      const number = this.nextNumber(actor.tenant_id, "work_order", "WO");
      const dueDates = groupItems.map((item) => item.due_date || order.due_date).filter(Boolean).sort();
      const assigned = groupItems.map((item) => item.assigned_user_id).filter(Boolean);
      const sameAssigned = assigned.length && assigned.every((id) => id === assigned[0]) ? assigned[0] : null;
      const snapshot = {
        order_id: order.id,
        order_number: order.order_number,
        order_title: order.title,
        grouping_mode: plan.mode,
        items: groupItems.map((item) => ({
          order_item_id: item.id,
          title: item.title,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          due_date: item.due_date,
          assigned_user_id: item.assigned_user_id,
          internal_note: item.internal_note,
        })),
      };
      this.db
        .prepare(
          `INSERT INTO work_orders
           (id, portable_id, tenant_id, order_id, work_order_number, title, grouping_mode, production_stage, completed, status,
            due_date, assigned_user_id, department_id, instructions_snapshot_json, created_by_user_id, sent_to_production_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', 0, 'active', ?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, order.id, number, group.title, plan.mode, dueDates[0] || null, sameAssigned, JSON.stringify(snapshot), actor.id, timestamp, timestamp, timestamp);
      groupItems.forEach((item, position) => {
        this.db.prepare("INSERT INTO work_order_items (id, tenant_id, work_order_id, order_item_id, position, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(randomUUID(), actor.tenant_id, id, item.id, position, timestamp);
      });
      created.push({ id, portable_id: pid, title: group.title, item_ids: group.item_ids });
    });
    return created;
  }

  sendOrderToProduction(actor, orderId, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    return this.transaction(() => {
      const existingRows = this.workOrderRows(actor, orderId);
      if (existingRows.length) {
        return { order: this.order(actor, orderId), work_orders: existingRows.map((row) => mapWorkOrder(row, this.workOrderItems(actor, row.id), this.workOrderSchedules(actor, row.id))), already_sent: true };
      }
      const order = this.order(actor, orderId);
      const plan = this.normalizeProductionSetup(actor, order, payload);
      const timestamp = now();
      const created = this.createWorkOrdersFromPlan(actor, order, plan, timestamp);
      this.db.prepare("UPDATE orders SET production_grouping_mode = ?, sent_to_production_at = ?, sent_to_production_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(plan.mode, timestamp, actor.id, timestamp, order.id, actor.tenant_id);
      this.audit(actor, "production.send_to_production", "order", order.id, order.portable_id, `Order ${order.order_number} sent to production`, { grouping_mode: plan.mode, work_orders: created });
      return { order: this.order(actor, orderId), work_orders: this.workOrdersForOrder(actor, orderId), already_sent: false };
    });
  }

  regroupOrderProduction(actor, orderId, payload) {
    return this.transaction(() => {
      const order = this.order(actor, orderId);
      const existing = this.workOrderRows(actor, orderId);
      if (!existing.length) return this.sendOrderToProduction(actor, orderId, payload);
      const existingIds = existing.map((row) => row.id);
      const oldWorkOrderPlaceholders = existingIds.map(() => "?").join(",");
      const timestamp = now();
      const hasStarted = existing.some((row) => !["not_started", "ready"].includes(row.production_stage) || row.completed);
      const futureEntries = this.db
        .prepare(
          `SELECT id, portable_id, title, work_order_id
           FROM calendar_events
           WHERE tenant_id = ?
             AND work_order_id IN (${oldWorkOrderPlaceholders})
             AND status = 'scheduled'
             AND start_at >= ?`,
        )
        .all(actor.tenant_id, ...existingIds, timestamp);
      if (hasStarted) {
        this.requireRole(actor, MANAGER_ROLES);
        const reason = normalizeTitle(payload?.reason || "");
        if (reason.length < 5) throw error("production_regroup_reason_required", 400);
        if (existing.some((row) => row.completed)) throw error("completed_work_order_reopen_required", 409);
        if (futureEntries.length && !payload?.calendar_resolution) throw error("calendar_resolution_required", 400);
      } else {
        this.requireRole(actor, WRITE_ROLES);
      }
      const plan = this.normalizeProductionSetup(actor, order, payload);
      this.db.prepare(`UPDATE work_order_items SET active = 0 WHERE tenant_id = ? AND work_order_id IN (${oldWorkOrderPlaceholders})`).run(actor.tenant_id, ...existingIds);
      this.db.prepare(`UPDATE work_orders SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND id IN (${oldWorkOrderPlaceholders})`).run(timestamp, actor.tenant_id, ...existingIds);
      const created = this.createWorkOrdersFromPlan(actor, order, plan, timestamp);
      if (futureEntries.length && payload?.calendar_resolution === "return_to_order") {
        this.db.prepare(`UPDATE calendar_events SET work_order_id = NULL, updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      } else if (futureEntries.length && payload?.calendar_resolution === "cancel") {
        const reason = normalizeTitle(payload?.calendar_resolution_reason || payload?.reason || "");
        if (reason.length < 5) throw error("calendar_resolution_reason_required", 400);
        this.db.prepare(`UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      } else if (futureEntries.length && payload?.calendar_resolution === "move_to_replacement") {
        const targetTitle = normalizeTitle(payload?.calendar_resolution_replacement_title || "");
        let target = null;
        if (targetTitle) target = created.find((entry) => entry.title.toLowerCase() === targetTitle.toLowerCase()) || null;
        if (!target && created.length === 1) target = created[0];
        if (!target) throw error("calendar_resolution_replacement_required", 400);
        this.db.prepare(`UPDATE calendar_events SET work_order_id = ?, updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(target.id, timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      }
      this.db.prepare("UPDATE orders SET production_grouping_mode = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(plan.mode, timestamp, order.id, actor.tenant_id);
      if (futureEntries.length && payload?.calendar_resolution && payload.calendar_resolution !== "keep_original") {
        this.audit(actor, "calendar.work_order_resolution", "order", order.id, order.portable_id, "Future Work Order calendar entries resolved during regroup", { calendar_event_ids: futureEntries.map((entry) => entry.id), resolution: payload.calendar_resolution });
      }
      this.audit(actor, "production.regroup", "order", order.id, order.portable_id, `Order ${order.order_number} production regrouped`, { grouping_mode: plan.mode, work_orders: created, reason: payload?.reason || null, calendar_resolution: payload?.calendar_resolution || "keep_original" });
      return { order: this.order(actor, orderId), work_orders: this.workOrdersForOrder(actor, orderId) };
    });
  }

  setWorkOrderStage(actor, id, stage) {
    this.requireRole(actor, WRITE_ROLES);
    if (!PRODUCTION_STAGES.includes(stage)) throw error("invalid_production_stage", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM work_orders WHERE id = ? AND tenant_id = ? AND status = 'active'").get(id, actor.tenant_id);
      if (!row) throw error("work_order_not_found", 404);
      if ((row.completed || row.production_stage === "complete") && stage !== "complete") this.requireRole(actor, MANAGER_ROLES);
      const timestamp = now();
      const completed = stage === "complete";
      this.db.prepare("UPDATE work_orders SET production_stage = ?, completed = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(stage, bool(completed), timestamp, id, actor.tenant_id);
      this.db.prepare("UPDATE order_items SET production_stage = ?, completed = ?, updated_at = ? WHERE tenant_id = ? AND id IN (SELECT order_item_id FROM work_order_items WHERE tenant_id = ? AND work_order_id = ? AND active = 1)").run(stage, bool(completed), timestamp, actor.tenant_id, actor.tenant_id, id);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      this.audit(actor, "work_order.stage_move", "work_order", id, row.portable_id, `Work Order moved from ${row.production_stage} to ${stage}`, { from: row.production_stage, to: stage, order_id: row.order_id });
      if (row.completed && !completed) this.audit(actor, "work_order.reopen", "work_order", id, row.portable_id, "Work Order reopened", { from: row.production_stage, to: stage, order_id: row.order_id });
      return { work_order: this.workOrderSummary(actor, id), order_progress: this.order(actor, row.order_id).production_progress };
    });
  }

  setWorkOrderCompletion(actor, id, completed) {
    this.requireRole(actor, WRITE_ROLES);
    if (typeof completed !== "boolean") throw error("invalid_completion", 400);
    return this.setWorkOrderStage(actor, id, completed ? "complete" : ACTIVE_REOPEN_STAGE);
  }

  bundleDocument(actor, documentType, documentId) {
    if (!BUNDLE_DOCUMENT_TYPES.includes(documentType)) throw error("invalid_bundle_document", 400);
    if (documentType === "estimate") {
      const row = this.db.prepare("SELECT * FROM estimates WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
      if (!row) throw error("estimate_not_found", 404);
      const items = this.db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND tenant_id = ? ORDER BY position").all(documentId, actor.tenant_id).map((item) => mapItem(item, "estimate_id"));
      return { doc: mapEstimate(row, items), itemType: "estimate_item", sourceOrderId: null, finalized: Boolean(row.converted_order_id), items };
    }
    if (documentType === "order") {
      const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
      if (!row) throw error("order_not_found", 404);
      const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(documentId, actor.tenant_id).map((item) => mapItem(item, "order_id"));
      return { doc: mapOrder(row, items), itemType: "order_item", sourceOrderId: row.id, finalized: false, items };
    }
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
    if (!row) throw error("invoice_not_found", 404);
    const items = this.db.prepare("SELECT oi.* FROM order_items oi WHERE oi.order_id = ? AND oi.tenant_id = ? ORDER BY oi.position").all(row.order_id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    return { doc: mapInvoice(row), itemType: "order_item", sourceOrderId: row.order_id, finalized: row.document_status !== "draft", items };
  }

  bundleAdjustedItems(actor, documentType, documentId, items) {
    const allocations = this.db
      .prepare(
        `SELECT cbi.item_id, cbi.allocated_cents
         FROM commercial_bundle_items cbi
         JOIN commercial_bundles cb ON cb.id = cbi.bundle_id AND cb.tenant_id = cbi.tenant_id
         WHERE cbi.tenant_id = ?
           AND cbi.document_type = ?
           AND cbi.document_id = ?
           AND cbi.active = 1
           AND cb.active = 1`,
      )
      .all(actor.tenant_id, documentType, documentId);
    const allocatedByItem = new Map(allocations.map((row) => [row.item_id, row.allocated_cents]));
    return items.map((item) => allocatedByItem.has(item.id) ? { ...item, line_total_cents: allocatedByItem.get(item.id) } : item);
  }

  recalculateDocumentTotalsForBundles(actor, documentType, documentId) {
    const document = this.bundleDocument(actor, documentType, documentId);
    const adjustedItems = this.bundleAdjustedItems(actor, documentType, documentId, document.items);
    const totals = documentTotals(adjustedItems, document.doc.discount_cents, document.doc.tax_rate_basis_points_snapshot, document.doc.customer_tax_exempt_snapshot);
    const timestamp = now();
    if (documentType === "estimate") {
      this.db
        .prepare("UPDATE estimates SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, timestamp, documentId, actor.tenant_id);
    } else if (documentType === "order") {
      this.db
        .prepare("UPDATE orders SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, timestamp, documentId, actor.tenant_id);
    } else {
      const balance = totals.total_cents - document.doc.amount_paid_cents;
      if (balance < 0) throw error("invoice_payment_exceeds_repriced_total", 409);
      const status = paymentStatus(totals.total_cents, document.doc.amount_paid_cents);
      this.db
        .prepare("UPDATE invoices SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, balance_due_cents = ?, payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, balance, status, timestamp, documentId, actor.tenant_id);
    }
    return totals;
  }

  assertBundleDocumentEditable(actor, documentType, documentId) {
    if (documentType !== "order") return;
    const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, documentId);
    if (invoice && invoice.document_status !== "draft") throw error("bundle_document_locked", 409);
  }

  allocationForBundle(bundle, items) {
    const subtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
    const target = bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : subtotal;
    if (bundle.pricing_mode === "bundle_price") {
      if (!Number.isInteger(bundle.manual_total_cents) || bundle.manual_total_cents < 0) throw error("invalid_bundle_total", 400);
      if (!normalizeTitle(bundle.override_reason || "")) throw error("bundle_override_reason_required", 400);
    }
    if (target === 0) return items.map((item) => ({ item_id: item.id, allocated_cents: 0 }));
    if (subtotal === 0) {
      const base = Math.floor(target / items.length);
      let remainder = target - base * items.length;
      return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((item) => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        return { item_id: item.id, allocated_cents: base + extra };
      });
    }
    let allocated = 0;
    const rows = items.map((item) => {
      const cents = Math.floor((target * item.line_total_cents) / subtotal);
      allocated += cents;
      return { item_id: item.id, allocated_cents: cents, weight: item.line_total_cents };
    });
    let remainder = target - allocated;
    rows.sort((a, b) => b.weight - a.weight || String(a.item_id).localeCompare(String(b.item_id)));
    for (const row of rows) {
      if (!remainder) break;
      row.allocated_cents += 1;
      remainder -= 1;
    }
    return rows.map(({ item_id, allocated_cents }) => ({ item_id, allocated_cents }));
  }

  listCommercialBundles(actor, documentType, documentId) {
    const document = this.bundleDocument(actor, documentType, documentId);
    const itemMap = new Map(document.items.map((item) => [item.id, item]));
    return this.db
      .prepare("SELECT * FROM commercial_bundles WHERE tenant_id = ? AND document_type = ? AND document_id = ? AND active = 1 ORDER BY display_order, title")
      .all(actor.tenant_id, documentType, documentId)
      .map((bundle) => {
        const items = this.db
          .prepare("SELECT * FROM commercial_bundle_items WHERE tenant_id = ? AND bundle_id = ? AND active = 1 ORDER BY rowid")
          .all(actor.tenant_id, bundle.id)
          .map((row) => ({ ...itemMap.get(row.item_id), allocated_cents: row.allocated_cents }))
          .filter(Boolean);
        return mapBundle(bundle, items);
      });
  }

  saveCommercialBundles(actor, documentType, documentId, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z.object({ bundles: z.array(bundleSchema).default([]) }).parse(payload);
    return this.transaction(() => {
      const document = this.bundleDocument(actor, documentType, documentId);
      if (document.finalized) throw error("bundle_document_locked", 409);
      this.assertBundleDocumentEditable(actor, documentType, documentId);
      const itemMap = new Map(document.items.map((item) => [item.id, item]));
      const assigned = new Set();
      const timestamp = now();
      const prepared = input.bundles.map((bundle, index) => {
        const itemIds = bundle.item_ids;
        for (const id of itemIds) {
          if (!itemMap.has(id)) throw error("bundle_item_not_found", 404);
          if (assigned.has(id)) throw error("bundle_item_assigned_twice", 400);
          assigned.add(id);
        }
        const items = itemIds.map((id) => itemMap.get(id));
        const allocation = this.allocationForBundle(bundle, items);
        return { ...bundle, display_order: bundle.display_order ?? index, items, allocation };
      });
      this.db.prepare("UPDATE commercial_bundle_items SET active = 0 WHERE tenant_id = ? AND document_type = ? AND document_id = ?").run(actor.tenant_id, documentType, documentId);
      this.db.prepare("UPDATE commercial_bundles SET active = 0, updated_at = ? WHERE tenant_id = ? AND document_type = ? AND document_id = ?").run(timestamp, actor.tenant_id, documentType, documentId);
      const created = [];
      for (const bundle of prepared) {
        const id = randomUUID();
        const pid = portable("commercial_bundle");
        const total = bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : bundle.items.reduce((sum, item) => sum + item.line_total_cents, 0);
        const snapshot = {
          pricing_mode: bundle.pricing_mode,
          total_cents: total,
          allocation: bundle.allocation,
          source_line_totals: bundle.items.map((item) => ({ item_id: item.id, line_total_cents: item.line_total_cents, taxable: item.taxable })),
        };
        this.db
          .prepare(
            `INSERT INTO commercial_bundles
             (id, portable_id, tenant_id, document_type, document_id, source_order_id, title, description, display_order,
              pricing_mode, manual_total_cents, override_reason, show_member_prices, allocation_snapshot_json, active, created_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, documentType, documentId, document.sourceOrderId, bundle.title, bundle.description || null, bundle.display_order, bundle.pricing_mode, bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : null, bundle.override_reason || null, bool(bundle.show_member_prices), JSON.stringify(snapshot), actor.id, timestamp, timestamp);
        const allocationById = new Map(bundle.allocation.map((entry) => [entry.item_id, entry.allocated_cents]));
        for (const item of bundle.items) {
          this.db.prepare("INSERT INTO commercial_bundle_items (id, tenant_id, bundle_id, document_type, document_id, item_type, item_id, allocated_cents, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").run(randomUUID(), actor.tenant_id, id, documentType, documentId, document.itemType, item.id, allocationById.get(item.id), timestamp);
        }
        created.push({ id, title: bundle.title, item_ids: bundle.item_ids, pricing_mode: bundle.pricing_mode, total_cents: total });
      }
      const totals = this.recalculateDocumentTotalsForBundles(actor, documentType, documentId);
      if (documentType === "order") {
        const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, documentId);
        if (invoice?.document_status === "draft") {
          this.copyBundles(actor, "order", documentId, "invoice", invoice.id);
        }
      }
      this.audit(actor, "commercial_bundle.save", documentType, documentId, document.doc.portable_id, `${documentType} bundle presentation saved`, { bundles: created });
      return { items: this.listCommercialBundles(actor, documentType, documentId), totals };
    });
  }

  copyBundles(actor, fromType, fromId, toType, toId, itemIdMap = new Map()) {
    const source = this.listCommercialBundles(actor, fromType, fromId);
    if (!source.length) return;
    const bundles = source.map((bundle) => ({
      title: bundle.title,
      description: bundle.description,
      display_order: bundle.display_order,
      pricing_mode: bundle.pricing_mode,
      manual_total_cents: bundle.manual_total_cents,
      override_reason: bundle.override_reason || "Copied from source document",
      show_member_prices: bundle.show_member_prices,
      item_ids: bundle.items.map((item) => itemIdMap.get(item.id) || item.id).filter(Boolean),
    })).filter((bundle) => bundle.item_ids.length);
    if (bundles.length) this.saveCommercialBundles(actor, toType, toId, { bundles });
  }

  productionBoard(actor, filters = {}) {
    const users = new Map(this.users(actor).map((user) => [user.id, user]));
    const workOrders = this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name, COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.status = 'active'
         GROUP BY wo.id
         ORDER BY COALESCE(wo.due_date, '9999-12-31'), wo.work_order_number`,
      )
      .all(actor.tenant_id)
      .map((row) => {
        const workOrder = mapWorkOrder(row, this.workOrderItems(actor, row.id));
        return {
          ...workOrder,
          record_type: "work_order",
          description: workOrder.items.map((item) => item.title).join(", "),
          assigned_user: row.assigned_user_id ? users.get(row.assigned_user_id) || null : null,
          late: Boolean(workOrder.due_date && workOrder.due_date < today() && workOrder.production_stage !== "complete"),
          production_progress: { completed: workOrder.completed ? 1 : 0, total: 1, percent: workOrder.completed ? 100 : 0 },
        };
      });
    const legacyItems = this.db
      .prepare(
        `SELECT oi.*, o.order_number, o.title AS order_title, o.status AS order_status, o.due_date AS order_due_date, c.contact_name, c.business_name
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND oi.production_required = 1
           AND NOT EXISTS (
             SELECT 1 FROM work_order_items woi
             JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
             WHERE woi.tenant_id = oi.tenant_id AND woi.order_item_id = oi.id AND woi.active = 1 AND wo.status = 'active'
           )
         ORDER BY COALESCE(oi.due_date, o.due_date, '9999-12-31'), o.order_number, oi.position`,
      )
      .all(actor.tenant_id)
      .map((row) => {
        const item = mapItem(row, "order_id");
        const effectiveDueDate = item.due_date || row.order_due_date || null;
        return {
          ...item,
          record_type: "order_item",
          due_date: effectiveDueDate,
          item_due_date: item.due_date,
          order_due_date: row.order_due_date,
          order_number: row.order_number,
          order_title: row.order_title,
          order_status: row.order_status,
          customer_name: row.business_name || row.contact_name,
          assigned_user: row.assigned_user_id ? users.get(row.assigned_user_id) || null : null,
          late: Boolean(effectiveDueDate && effectiveDueDate < today() && item.production_stage !== "complete"),
          production_progress: this.order(actor, row.order_id).production_progress,
        };
      });
    const rows = [...workOrders, ...legacyItems]
      .filter((row) => !filters.stage || filters.stage === "all" || row.production_stage === filters.stage)
      .filter((row) => !filters.assigned_user_id || filters.assigned_user_id === "all" || (filters.assigned_user_id === "unassigned" ? !row.assigned_user_id : row.assigned_user_id === filters.assigned_user_id))
      .filter((row) => filters.due_state !== "late" || row.late)
      .filter(() => !filters.due_state || filters.due_state === "all" || filters.due_state === "late");
    const response = { stages: PRODUCTION_STAGES, items: rows, users: [...users.values()].filter((user) => user.active) };
    return canViewFinancials(actor) ? response : stripFinancialFields(response);
  }

  setProductionStage(actor, itemId, stage) {
    this.requireRole(actor, WRITE_ROLES);
    if (!PRODUCTION_STAGES.includes(stage)) throw error("invalid_production_stage", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
      if (!row) throw error("order_item_not_found", 404);
      if (this.activeWorkOrderMembership(actor, itemId)) throw error("work_order_item_stage_managed_by_work_order", 409);
      const timestamp = now();
      const completed = stage === "complete";
      this.db.prepare("UPDATE order_items SET production_stage = ?, completed = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(stage, bool(completed), timestamp, itemId, actor.tenant_id);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      this.auditProductionTransitions(actor, row, { ...row, production_stage: stage, completed }, timestamp);
      const order = this.order(actor, row.order_id);
      return { item: order.items.find((item) => item.id === itemId), order_progress: order.production_progress };
    });
  }

  setItemCompletion(actor, itemId, completed) {
    this.requireRole(actor, WRITE_ROLES);
    if (typeof completed !== "boolean") throw error("invalid_completion", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
      if (!row) throw error("order_item_not_found", 404);
      if (this.activeWorkOrderMembership(actor, itemId)) throw error("work_order_item_stage_managed_by_work_order", 409);
      const timestamp = now();
      const stage = completed ? "complete" : ACTIVE_REOPEN_STAGE;
      this.db.prepare("UPDATE order_items SET completed = ?, production_stage = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(bool(completed), stage, timestamp, itemId, actor.tenant_id);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      this.auditProductionTransitions(actor, row, { ...row, production_stage: stage, completed }, timestamp);
      const order = this.order(actor, row.order_id);
      return { item: order.items.find((item) => item.id === itemId), order_progress: order.production_progress };
    });
  }

  validateAttachmentInput(filename, mimeType, path) {
    const original = safeFilename(filename);
    const stat = statSync(path);
    const size = stat.size;
    if (!size) throw error("attachment_empty", 400);
    if (size > uploadLimitBytes()) throw error("attachment_too_large", 413);
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    if (BLOCKED_EXTENSION_RE.test(original)) throw error("attachment_type_not_allowed", 400);
    const extension = fileExtension(original);
    if (!MIME_EXTENSIONS[mimeType]?.has(extension)) throw error("attachment_type_not_allowed", 400);
    verifyAttachmentContent(path, mimeType);
    return original;
  }

  listOrderAttachments(actor, orderId) {
    this.order(actor, orderId);
    return this.db
      .prepare("SELECT * FROM order_attachments WHERE tenant_id = ? AND order_id = ? AND deleted_at IS NULL ORDER BY created_at DESC")
      .all(actor.tenant_id, orderId)
      .map(mapAttachment);
  }

  uploadOrderAttachment(actor, orderId, file) {
    this.requireRole(actor, WRITE_ROLES);
    const order = this.order(actor, orderId);
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    const sourceType = attachmentSourceType(file);
    let sourcePath = file?.temp_path || null;
    const createdSource = !sourcePath;
    const id = randomUUID();
    const pid = portable("order_attachment");
    const timestamp = now();
    let finalPath = null;
    let storageKey = null;
    let fallbackTempDir = null;
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    if (!sourcePath) {
      fallbackTempDir = mkdtempSync(join(tmpdir(), "signguy-slim-buffer-upload-"));
      sourcePath = join(fallbackTempDir, randomUUID());
      writeFileSync(sourcePath, buffer, { flag: "wx" });
    }
    try {
      const original = this.validateAttachmentInput(file?.filename, mimeType, sourcePath);
      if (sourceType === "device_capture" && !IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
      const stat = statSync(sourcePath);
      const byteSize = stat.size;
      const sha256 = fileSha256(sourcePath);
      if (file?.byte_size !== undefined && file.byte_size !== byteSize) throw error("attachment_integrity_mismatch", 409);
      if (file?.sha256 && file.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
      const dimensions = imageDimensions(sourcePath, mimeType);
      const extension = fileExtension(original);
      storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
      finalPath = this.attachmentPath(storageKey);
      return this.transaction(() => {
        renameSync(sourcePath, finalPath);
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at, source_type, image_width, image_height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, orderId, original, storageKey, mimeType, byteSize, sha256, actor.id, timestamp, sourceType, dimensions.width, dimensions.height);
        const action = sourceType === "device_capture" ? "attachment.device_capture" : "attachment.upload";
        this.audit(actor, action, "order", orderId, order.portable_id, `Attachment ${original} uploaded`, { attachment_id: id, sha256, source_type: sourceType });
        return mapAttachment(this.db.prepare("SELECT * FROM order_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
      });
    } catch (err) {
      try {
        if (existsSync(sourcePath)) rmSync(sourcePath, { force: true });
        if (finalPath && existsSync(finalPath) && !this.db.prepare("SELECT id FROM order_attachments WHERE storage_key = ?").get(storageKey)) rmSync(finalPath, { force: true });
      } catch {
        // Best-effort cleanup; the original failure remains authoritative.
      }
      throw err;
    } finally {
      if (createdSource && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
      if (fallbackTempDir && existsSync(fallbackTempDir)) rmSync(fallbackTempDir, { recursive: true, force: true });
      if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
    }
  }

  createAnnotatedAttachment(actor, orderId, sourceAttachmentId, file) {
    this.requireRole(actor, WRITE_ROLES);
    const order = this.order(actor, orderId);
    const source = this.attachmentRecord(actor, orderId, sourceAttachmentId);
    if (!IMAGE_ATTACHMENT_MIME_TYPES.has(source.mime_type)) throw error("annotation_source_not_image", 400);
    const originalId = source.original_attachment_id || source.id;
    this.attachmentRecord(actor, orderId, originalId);
    const operations = annotationOperationsFromField(file?.fields?.annotation_json);
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    if (!IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    let sourcePath = file?.temp_path || null;
    const createdSource = !sourcePath;
    const id = randomUUID();
    const pid = portable("order_attachment");
    const timestamp = now();
    let finalPath = null;
    let storageKey = null;
    let fallbackTempDir = null;
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    if (!sourcePath) {
      fallbackTempDir = mkdtempSync(join(tmpdir(), "signguy-slim-buffer-upload-"));
      sourcePath = join(fallbackTempDir, randomUUID());
      writeFileSync(sourcePath, buffer, { flag: "wx" });
    }
    try {
      const requestedName = file?.filename || `${source.original_filename.replace(/\.[^.]+$/, "")}-annotated.png`;
      const original = this.validateAttachmentInput(requestedName, mimeType, sourcePath);
      const stat = statSync(sourcePath);
      const byteSize = stat.size;
      const sha256 = fileSha256(sourcePath);
      if (file?.byte_size !== undefined && file.byte_size !== byteSize) throw error("attachment_integrity_mismatch", 409);
      if (file?.sha256 && file.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
      const dimensions = imageDimensions(sourcePath, mimeType);
      const extension = fileExtension(original);
      storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
      finalPath = this.attachmentPath(storageKey);
      return this.transaction(() => {
        renameSync(sourcePath, finalPath);
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id,
              created_at, source_type, original_attachment_id, derivative_type, image_width, image_height, annotation_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'annotation_derivative', ?, 'annotation', ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, orderId, original, storageKey, mimeType, byteSize, sha256, actor.id, timestamp, originalId, dimensions.width, dimensions.height, JSON.stringify(operations));
        this.audit(actor, "attachment.annotation_create", "order", orderId, order.portable_id, `Annotated copy ${original} created`, {
          attachment_id: id,
          original_attachment_id: originalId,
          source_attachment_id: source.id,
          sha256,
          operation_count: operations.length,
        });
        return mapAttachment(this.db.prepare("SELECT * FROM order_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
      });
    } catch (err) {
      try {
        if (existsSync(sourcePath)) rmSync(sourcePath, { force: true });
        if (finalPath && existsSync(finalPath) && !this.db.prepare("SELECT id FROM order_attachments WHERE storage_key = ?").get(storageKey)) rmSync(finalPath, { force: true });
      } catch {
        // Best-effort cleanup; the original failure remains authoritative.
      }
      throw err;
    } finally {
      if (createdSource && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
      if (fallbackTempDir && existsSync(fallbackTempDir)) rmSync(fallbackTempDir, { recursive: true, force: true });
      if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
    }
  }

  attachmentRecord(actor, orderId, attachmentId, { includeDeleted = false } = {}) {
    this.order(actor, orderId);
    const row = this.db
      .prepare(`SELECT * FROM order_attachments WHERE id = ? AND order_id = ? AND tenant_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`)
      .get(attachmentId, orderId, actor.tenant_id);
    if (!row) throw error("attachment_not_found", 404);
    return row;
  }

  attachmentDownload(actor, orderId, attachmentId, { preview = false } = {}) {
    const row = this.attachmentRecord(actor, orderId, attachmentId);
    if (preview && !PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type)) throw error("attachment_preview_not_allowed", 400);
    const fullPath = this.attachmentPath(row.storage_key);
    if (!existsSync(fullPath)) throw error("attachment_file_missing", 404);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error("attachment_file_missing", 404);
    if (stat.size !== row.byte_size || fileSha256(fullPath) !== row.sha256) throw error("attachment_integrity_mismatch", 409);
    const disposition = preview ? "inline" : "attachment";
    const order = this.order(actor, orderId);
    this.audit(actor, preview ? "attachment.preview" : "attachment.download", "order", orderId, order.portable_id, `${preview ? "Previewed" : "Downloaded"} ${row.original_filename}`, { attachment_id: attachmentId });
    return {
      stream: createReadStream(fullPath),
      byte_size: row.byte_size,
      mime_type: row.mime_type,
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": contentDisposition(row.original_filename, disposition),
        "X-Content-Type-Options": "nosniff",
      },
    };
  }

  deleteOrderAttachment(actor, orderId, attachmentId) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const row = this.attachmentRecord(actor, orderId, attachmentId);
      const deletedAt = now();
      this.db.prepare("UPDATE order_attachments SET deleted_at = ? WHERE id = ? AND tenant_id = ?").run(deletedAt, attachmentId, actor.tenant_id);
      const order = this.order(actor, orderId);
      this.audit(actor, "attachment.delete", "order", orderId, order.portable_id, `Attachment ${row.original_filename} deleted`, { attachment_id: attachmentId });
      return { ok: true, deleted_at: deletedAt };
    });
  }

  updateOrderStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "active", "on_hold", "complete", "cancelled"].includes(status)) throw error("invalid_order_status");
    return this.transaction(() => {
      const order = this.order(actor, id);
      this.db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
      this.audit(actor, "order.status", "order", id, order.portable_id, `Order status changed to ${status}`, { from: order.status, to: status });
      return this.order(actor, id);
    });
  }

  createOrOpenInvoice(actor, orderId, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
    if (existing) return { invoice: this.invoice(actor, existing.id), already_exists: true };
    return this.transaction(() => {
      const existingInTxn = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
      if (existingInTxn) return { invoice: this.invoice(actor, existingInTxn.id), already_exists: true };
      const order = this.order(actor, orderId);
      const id = randomUUID();
      const pid = portable("invoice");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "invoice", "I");
      try {
        this.db
          .prepare(
            `INSERT INTO invoices
             (id, portable_id, tenant_id, order_id, customer_id, invoice_number, document_date, due_date, document_status, payment_status,
              customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
              amount_paid_cents, balance_due_cents, historical_amount_paid_note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, order.id, order.customer_id, number, payload.document_date ?? today(), payload.due_date ?? order.due_date ?? null, bool(order.customer_tax_exempt_snapshot), order.tax_rate_basis_points_snapshot, order.subtotal_cents, order.discount_cents, order.tax_cents, order.total_cents, order.total_cents, "Payment information is manually recorded.", timestamp, timestamp);
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
          const winner = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
          if (winner) return { invoice: mapInvoice(winner), already_exists: true };
        }
        throw err;
      }
      this.copyBundles(actor, "order", order.id, "invoice", id);
      this.audit(actor, "invoice.create", "invoice", id, pid, `Invoice ${number} created from ${order.order_number}`, { order_id: order.id });
      return { invoice: this.invoice(actor, id), already_exists: false };
    });
  }

  invoice(actor, id) {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("invoice_not_found", 404);
    const invoice = mapInvoice(row);
    invoice.items = this.order(actor, invoice.order_id).items;
    invoice.bundles = this.listCommercialBundles(actor, "invoice", id);
    return invoice;
  }

  listInvoices(actor) {
    return this.db.prepare("SELECT * FROM invoices WHERE tenant_id = ? ORDER BY invoice_number DESC").all(actor.tenant_id).map(mapInvoice);
  }

  setInvoiceDocumentStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "issued", "void"].includes(status)) throw error("invalid_invoice_document_status");
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    this.db.prepare("UPDATE invoices SET document_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
    this.audit(actor, "invoice.document_status", "invoice", id, invoice.portable_id, `Invoice document status changed to ${status}`, { from: invoice.document_status, to: status });
    return this.invoice(actor, id);
  }

  recordInvoicePayment(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = z.object({ amount_paid_cents: z.number().int().nonnegative(), note: z.string().nullable().optional() }).parse(payload);
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    const status = paymentStatus(invoice.total_cents, input.amount_paid_cents);
    const balance = invoice.total_cents - input.amount_paid_cents;
    this.db
      .prepare(
        "UPDATE invoices SET amount_paid_cents = ?, balance_due_cents = ?, payment_status = ?, historical_amount_paid_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      )
      .run(input.amount_paid_cents, balance, status, input.note ?? "Payment information is manually recorded.", now(), id, actor.tenant_id);
    this.audit(actor, "invoice.payment_status", "invoice", id, invoice.portable_id, `Invoice payment manually recorded as ${status}`, { amount_paid_cents: input.amount_paid_cents, balance_due_cents: balance });
    return this.invoice(actor, id);
  }

  auditTrail(actor, entityType, entityId) {
    return this.db
      .prepare("SELECT *, diff_json FROM audit_events WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? ORDER BY occurred_at DESC")
      .all(actor.tenant_id, entityType, entityId)
      .map((row) => ({ ...row, diff: parseJson(row.diff_json), diff_json: undefined }));
  }

  documentPdf(actor, type, id) {
    const tenant = this.tenant(actor.tenant_id);
    const doc = type === "estimate" ? this.estimate(actor, id) : this.invoice(actor, id);
    const customer = this.customer(actor, doc.customer_id);
    const currency = (value) => formatCents(value, tenant.currency, tenant.locale);
    const lines = [
      `Company: ${tenant.company_name}`,
      `Company address: ${tenant.address.line1}${tenant.address.line2 ? `, ${tenant.address.line2}` : ""}, ${tenant.address.city}, ${tenant.address.state} ${tenant.address.postal_code}, ${tenant.address.country}`,
      `Company contact: ${tenant.contact_email || ""} ${tenant.contact_phone || ""}`.trim(),
      `Customer: ${customer.contact_name}${customer.business_name ? ` / ${customer.business_name}` : ""}`,
      `Customer email: ${customer.email || ""} phone: ${customer.phone || ""}`,
      `Billing address: ${customer.billing_address.line1}${customer.billing_address.line2 ? `, ${customer.billing_address.line2}` : ""}, ${customer.billing_address.city}, ${customer.billing_address.state} ${customer.billing_address.postal_code}, ${customer.billing_address.country}`,
      type === "estimate" ? `Quote ${doc.estimate_number} status ${doc.status}` : `Invoice ${doc.invoice_number} document ${doc.document_status} payment ${doc.payment_status}`,
      `Document date: ${doc.document_date}`,
    ];
    if (type === "estimate") {
      lines.push(`Expiration date: ${doc.expires_at || ""}`);
      lines.push(`Follow-up date: ${doc.follow_up_at || ""}`);
    } else {
      lines.push(`Due date: ${doc.due_date || ""}`);
    }
    const items = type === "estimate" ? doc.items : this.order(actor, doc.order_id).items;
    const bundles = doc.bundles || [];
    const bundledItemIds = new Set();
    for (const bundle of bundles) {
      lines.push(`Bundle: ${bundle.title}${bundle.description ? ` - ${bundle.description}` : ""} | Total ${currency(bundle.total_cents)}`);
      for (const item of bundle.items) {
        bundledItemIds.add(item.id);
        if (bundle.show_member_prices) {
          const lineCents = bundle.pricing_mode === "bundle_price" ? item.allocated_cents : item.line_total_cents;
          lines.push(`  ${item.title} | Qty ${item.quantity_decimal} | Line ${currency(lineCents)} | ${item.taxable ? "Taxable" : "Non-taxable"}`);
        } else {
          lines.push(`  ${item.title} | Qty ${item.quantity_decimal}`);
        }
      }
    }
    for (const item of items.filter((entry) => !bundledItemIds.has(entry.id))) {
      lines.push(`${item.title} | Qty ${item.quantity_decimal} | Unit ${currency(item.unit_price_cents)} | Line ${currency(item.line_total_cents)} | ${item.taxable ? "Taxable" : "Non-taxable"}`);
    }
    lines.push(`Subtotal ${currency(doc.subtotal_cents)}`);
    lines.push(`Discount ${currency(doc.discount_cents)}`);
    lines.push(`Tax ${currency(doc.tax_cents)}`);
    lines.push(`Total ${currency(doc.total_cents)}`);
    if (type === "invoice") {
      lines.push(`Amount paid ${currency(doc.amount_paid_cents)}`);
      lines.push(`Balance due ${currency(doc.balance_due_cents)}`);
      lines.push("Payment information is manually recorded.");
    }
    return renderPdf({ title: type === "estimate" ? "Quote" : "Invoice", lines });
  }
}
