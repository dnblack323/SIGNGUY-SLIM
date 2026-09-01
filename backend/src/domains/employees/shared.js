import { randomUUID } from "node:crypto";
import { z } from "zod";

export const ROLES = ["owner", "admin", "manager", "staff"];
export const ADMIN_ROLES = new Set(["owner", "admin"]);
export const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
export const PAY_WEEK_DAYS = 6;
export const IMPLAUSIBLE_SHIFT_MINUTES = 16 * 60;
export const PAY_LEDGER_TYPES = ["advance", "adjustment", "manual_payment"];
export const ANNOUNCEMENT_AUDIENCES = ["all", ...ROLES];

let lastTimestampMs = 0;

export function now() {
  const current = Date.now();
  lastTimestampMs = Math.max(current, lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function payWeekStart(dateString) {
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  const daysSinceSaturday = (date.getUTCDay() + 1) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  return date.toISOString().slice(0, 10);
}

export function payWeekEnd(weekStart) {
  return addDays(weekStart, PAY_WEEK_DAYS);
}

export function localDateParts(instant, timezone) {
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

export function localDateForInstant(instant, timezone) {
  const parts = localDateParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
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

export function parseShopDateTime(value, timezone) {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  let utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  for (let i = 0; i < 2; i += 1) utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - timezoneOffsetMinutes(new Date(utcMs), timezone) * 60000;
  return new Date(utcMs).toISOString();
}

export function normalizeTimedDateTime(value, timeZone) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value))) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw error("invalid_calendar_datetime", 400);
    return date.toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) throw error("invalid_calendar_datetime", 400);
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

export function localDateTimeDisplay(value, timezone) {
  if (!value) return "";
  const parts = localDateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function minutesBetween(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

export function grossCentsForMinutes(minutes, rateCents) {
  return Math.floor((Number(minutes) * Number(rateCents) + 30) / 60);
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

export function payWeekStartsForInterval(clockInAt, clockOutAt, timezone) {
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

export function overlappedMinutes(entry, startUtc, endUtc) {
  const startMs = Math.max(new Date(entry.clock_in_at).getTime(), new Date(startUtc).getTime());
  const endMs = Math.min(new Date(entry.clock_out_at).getTime(), new Date(endUtc).getTime());
  if (endMs <= startMs) return 0;
  return minutesBetween(isoFromMs(startMs), isoFromMs(endMs));
}

export function bool(value) {
  return value ? 1 : 0;
}

export function portable(type) {
  return `sgp_v1_${type}_${randomUUID()}`;
}

export function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

export function error(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

export function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function mapEmployee(row, { includePay = false } = {}) {
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

export function mapTimeEntry(row, timezone = "America/New_York", { includePay = false } = {}) {
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

export function mapPayWeek(row) {
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

export function ledgerRow(row, type) {
  return {
    ...row,
    type,
    voided: Boolean(row.voided_at),
  };
}

export function mapAnnouncement(row) {
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

export function mapMessage(row, actorId) {
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

export const employeeSchema = z.object({
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

export const employeeUpdateSchema = employeeSchema.omit({ user_id: true, hourly_rate_cents: true, rate_effective_date: true }).partial();

export const employeeRateSchema = z.object({
  hourly_rate_cents: z.number().int().nonnegative(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable().optional(),
});

export const clockNoteSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

export const adminTimeEntrySchema = z.object({
  employee_id: z.string().min(1),
  clock_in_at: z.string().trim().min(1),
  clock_out_at: z.string().trim().min(1),
  clock_in_note: z.string().trim().max(500).nullable().optional(),
  clock_out_note: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

export const timeCorrectionSchema = z.object({
  clock_in_at: z.string().trim().min(1).optional(),
  clock_out_at: z.string().trim().min(1).nullable().optional(),
  clock_in_note: z.string().trim().max(500).nullable().optional(),
  clock_out_note: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

export const payWeekFilterSchema = z.object({
  employee_id: z.string().optional(),
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const advanceSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().positive(),
  advance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(500),
});

export const adjustmentSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["positive", "negative"]),
  amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

export const manualPaymentSchema = z.object({
  employee_id: z.string().min(1),
  pay_week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().positive(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.string().trim().max(80).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const voidLedgerSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const reopenPayWeekSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  publish_at: z.string().trim().min(1).optional(),
  expires_at: z.string().trim().min(1).nullable().optional(),
  audience_role: z.enum(ANNOUNCEMENT_AUDIENCES).default("all"),
}).strict();

export const announcementUpdateSchema = announcementSchema.partial();

export const directMessageSchema = z.object({
  recipient_user_id: z.string().trim().min(1),
  body: z.string().trim().min(1).max(4000),
  sender_user_id: z.string().trim().min(1).optional(),
}).strict();
