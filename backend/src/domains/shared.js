import { createHash, createHmac, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { documentTotals, formatCents, lineTotalCents, paymentStatus } from "../money.js";
import { now, today } from "../timestamps.js";
import { attachmentRoot } from "../config.js";
import { ACTIVE_REOPEN_STAGE, PRODUCTION_STAGES, compatibilitySnapshotForItem, completedForProductionStage, decorateOrderItemsWithProductionState, deriveOrderItemProductionState, deriveOrderProductionSummary, isProductionStage, normalizeWorkOrderState } from "./production/state.js";
import { activeProductionWorkOrderCompletionPredicate, activeProductionWorkOrderForItem } from "./production/queries.js";

export { closeSync, copyFileSync, createHash, createHmac, createReadStream, documentTotals, formatCents, lineTotalCents, paymentStatus, randomUUID, now, today, z, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, tmpdir, basename, dirname, join, resolve, ACTIVE_REOPEN_STAGE, PRODUCTION_STAGES, compatibilitySnapshotForItem, completedForProductionStage, decorateOrderItemsWithProductionState, deriveOrderItemProductionState, deriveOrderProductionSummary, isProductionStage, normalizeWorkOrderState, activeProductionWorkOrderCompletionPredicate, activeProductionWorkOrderForItem };

export const ROLES = ["owner", "admin", "manager", "staff"];
export const WRITE_ROLES = new Set(ROLES);
export const ADMIN_ROLES = new Set(["owner", "admin"]);
export const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
export const CALENDAR_STATUSES = ["scheduled", "complete", "cancelled"];
export const CALENDAR_ENTRY_TYPES = ["event", "task", "appointment"];
export const CALENDAR_FEED_TYPES = [...CALENDAR_ENTRY_TYPES, "production", "deadline"];
export const SCHEDULE_CATEGORIES = ["general", "production", "installation", "sales", "customer_appointment", "site_survey", "pickup", "delivery", "meeting", "deadline", "other"];
export const RESOURCE_TYPES = ["equipment", "vehicle", "production_area", "installation_crew", "other"];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
export const LINKED_RECORD_TYPES = ["all", "none", "estimate", "order", "order_item", "work_order"];
export const PRODUCTION_GROUPING_MODES = ["whole_order", "individual_items", "custom_groups"];
export const BUNDLE_DOCUMENT_TYPES = ["estimate", "order", "invoice"];
export const BUNDLE_PRICING_MODES = ["itemized_subtotal", "bundle_price"];
export const COMMUNICATION_CHANNELS = ["email", "phone", "walk_in", "manual"];
export const INTAKE_STATUSES = ["new", "reviewing", "need_information", "waiting_for_customer", "ready_to_create", "converted_to_order", "attached_to_existing_order", "closed_not_an_order"];
export const FINANCIAL_FIELDS = [
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
export const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const ANNOTATION_OPERATIONS_LIMIT_BYTES = 120 * 1024;
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
]);
export const IMAGE_ATTACHMENT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const PREVIEW_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "text/plain"]);
export const BLOCKED_EXTENSION_RE = /\.(app|apk|bat|cmd|com|cpl|dll|dmg|exe|gadget|hta|html?|iso|jar|js|jse|jsx|lnk|mjs|msi|php|pl|ps1|py|rb|reg|scr|sh|svg|swf|ts|tsx|vb|vbe|vbs|wsf|xml)$/i;
export const MIME_EXTENSIONS = {
  "application/pdf": new Set([".pdf"]),
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/gif": new Set([".gif"]),
  "image/webp": new Set([".webp"]),
  "text/plain": new Set([".txt", ".text", ".log"]),
  "text/csv": new Set([".csv"]),
  "application/json": new Set([".json"]),
};

export const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(2),
});

export const quickItemSchema = z.object({
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

export const workspaceItemSchema = quickItemSchema.extend({
  production_stage: z.enum(PRODUCTION_STAGES).default("not_started"),
  completed: z.boolean().default(false),
});

export const orderWorkspaceSchema = z.object({
  expected_updated_at: z.string().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  document_date: z.string().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).optional(),
  discount_cents: z.number().int().nonnegative().optional(),
  internal_notes: z.string().nullable().optional(),
  items: z.array(workspaceItemSchema).min(1).optional(),
});

export const calendarEventSchema = z.object({
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

export const departmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().min(1).default("#255b73"),
  active: z.boolean().default(true),
  display_order: z.number().int().optional(),
  memberships: z.array(z.object({ user_id: z.string().min(1), primary_department: z.boolean().default(false), active: z.boolean().default(true) })).optional(),
});

export const resourceSchema = z.object({
  name: z.string().min(1),
  resource_type: z.enum(RESOURCE_TYPES),
  description: z.string().nullable().optional(),
  capacity: z.number().int().positive().default(1),
  color: z.string().min(1).default("#64748b"),
  active: z.boolean().default(true),
  department_id: z.string().nullable().optional(),
  unavailable: z.array(z.object({ start_at: z.string().min(1), end_at: z.string().min(1), reason: z.string().min(1).default("Unavailable"), hard_block: z.boolean().default(true) })).optional(),
});

export const scheduleViewFiltersSchema = z.object({
  schedule_categories: z.array(z.enum(SCHEDULE_CATEGORIES)).default([]),
  entry_types: z.array(z.enum(CALENDAR_ENTRY_TYPES)).default([]),
  department_ids: z.array(z.string()).default([]),
  employee_ids: z.array(z.string()).default([]),
  resource_ids: z.array(z.string()).default([]),
  statuses: z.array(z.enum(CALENDAR_STATUSES)).default([]),
  linked: z.enum(["all", "linked", "unlinked", "estimate", "order", "order_item"]).default("all"),
}).strict();

export const workOrderGroupSchema = z.object({
  title: z.string().trim().min(1).max(120),
  item_ids: z.array(z.string().min(1)).min(1),
});

export const productionSetupSchema = z.object({
  mode: z.enum(PRODUCTION_GROUPING_MODES),
  groups: z.array(workOrderGroupSchema).optional(),
  independent_item_ids: z.array(z.string().min(1)).optional(),
  reason: z.string().trim().max(500).optional(),
  calendar_resolution: z.enum(["keep_original", "move_to_replacement", "return_to_order", "cancel"]).optional(),
  calendar_resolution_replacement_title: z.string().trim().max(120).optional(),
  calendar_resolution_reason: z.string().trim().max(500).optional(),
});

export const bundleSchema = z.object({
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

export const scheduleViewSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().min(1).default("#255b73"),
  visibility: z.enum(["shared", "personal"]).default("personal"),
  active: z.boolean().default(true),
  display_order: z.number().int().optional(),
  filters: scheduleViewFiltersSchema,
}).strict();

export const emailSettingsSchema = z.object({
  sender_name: z.string().trim().max(120).optional(),
  sender_email: z.string().email().nullable().optional(),
  sendgrid_verified: z.boolean().optional(),
});

export const emailSendSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(160),
  to_email: z.string().email().optional(),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().trim().min(1).max(180),
  body_text: z.string().trim().min(1).max(10000),
  confirm_unsaved_recipient: z.boolean().default(false),
  attach_document: z.boolean().default(true),
  order_attachment_ids: z.array(z.string().min(1)).default([]),
});

export const manualCommunicationSchema = z.object({
  customer_id: z.string().min(1),
  direction: z.enum(["inbound", "outbound", "internal"]).default("inbound"),
  channel: z.enum(COMMUNICATION_CHANNELS).default("phone"),
  subject: z.string().trim().max(180).nullable().optional(),
  body_text: z.string().trim().min(1).max(10000),
  related_entity_type: z.enum(["customer", "estimate", "order", "invoice", "order_intake"]).nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
});

export const intakeUpdateSchema = z.object({
  status: z.enum(INTAKE_STATUSES).optional(),
  customer_id: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  follow_up_at: z.string().nullable().optional(),
  summary: z.string().trim().min(1).max(300).optional(),
  internal_notes: z.string().trim().max(5000).nullable().optional(),
});

export const intakeCustomerSchema = z.object({
  contact_name: z.string().trim().min(1).max(120),
  business_name: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  billing_address: addressSchema.optional(),
});

export const inboundIntakeSchema = z.object({
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

export const annotationColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
export const annotationPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export const annotationStrokeSchema = z.number().int().min(1).max(24);
export const annotationOperationSchema = z.discriminatedUnion("type", [
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
export const annotationOperationsSchema = z.array(annotationOperationSchema).min(1).max(200);
export function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayInTimeZone(timeZone = "America/New_York") {
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

export function timezoneOffsetMs(date, timeZone) {
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

export function zonedLocalToUtc(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) throw error("invalid_calendar_datetime", 400);
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

export function normalizeTimedDateTime(value, timeZone) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value))) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw error("invalid_calendar_datetime", 400);
    return date.toISOString();
  }
  return zonedLocalToUtc(value, timeZone);
}

export function localDateFor(value, tenant) {
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

export function localTimeFor(value, tenant) {
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

export function portable(type) {
  return `sgp_v1_${type}_${randomUUID()}`;
}

export function bool(value) {
  return value ? 1 : 0;
}

export function inflateBool(row, fields) {
  for (const field of fields) row[field] = Boolean(row[field]);
  return row;
}

export function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

export function listParam(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "" || value === "all") return [];
  return String(value).split(",").map((part) => part.trim()).filter(Boolean);
}

export function error(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

export function normalizeTitle(value, fallback = "") {
  const title = String(value ?? fallback ?? "").trim().replace(/\s+/g, " ");
  return title.slice(0, 160);
}

export function fallbackOrderTitle(row) {
  return normalizeTitle(row?.title, row?.order_number ? `Order ${row.order_number}` : "Order");
}

export function fallbackItemTitle(row) {
  return normalizeTitle(row?.title, row?.description || `Item ${(Number(row?.position) || 0) + 1}`);
}

export function canViewFinancials(actor) {
  return MANAGER_ROLES.has(actor?.role);
}

export function stripFinancialFields(value) {
  if (Array.isArray(value)) return value.map(stripFinancialFields);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FINANCIAL_FIELDS.includes(key) || /(^|_)(price|total|subtotal|tax|payment|cost|margin|allocation|override_reason)/i.test(key)) continue;
    output[key] = stripFinancialFields(entry);
  }
  return output;
}

export function storageRoot() {
  return attachmentRoot();
}

export function uploadLimitBytes() {
  const parsed = Number(process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES || DEFAULT_UPLOAD_LIMIT_BYTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_LIMIT_BYTES;
}

export function safeFilename(name) {
  const leaf = basename(String(name || "attachment").replace(/\\/g, "/"));
  // Control characters are intentionally stripped from uploaded filenames.
  // eslint-disable-next-line no-control-regex
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+$/, "attachment");
  return cleaned.slice(0, 180) || "attachment";
}

export function assertInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}\\`) && !resolved.startsWith(`${resolvedRoot}/`)) {
    throw error("attachment_path_invalid", 400);
  }
  return resolved;
}

export function contentDisposition(filename, disposition = "attachment") {
  const safe = safeFilename(filename).replace(/"/g, "'");
  return `${disposition}; filename="${safe}"`;
}

export function fileExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

export function assertNoSymlinkAncestors(target, stopAt) {
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

export function readPrefix(path, length = 512) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

export function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function isBinary(buffer) {
  return buffer.includes(0);
}

export function assertSafeTextContent(path, mimeType) {
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

export function verifyAttachmentContent(path, mimeType) {
  const prefix = readPrefix(path, 512);
  if (mimeType === "application/pdf" && prefix.subarray(0, 5).toString("latin1") !== "%PDF-") throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/png" && !prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/jpeg" && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/gif" && !["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("latin1"))) throw error("attachment_type_not_allowed", 400);
  if (mimeType === "image/webp" && !(prefix.subarray(0, 4).toString("latin1") === "RIFF" && prefix.subarray(8, 12).toString("latin1") === "WEBP")) throw error("attachment_type_not_allowed", 400);
  if (["text/plain", "text/csv", "application/json"].includes(mimeType)) assertSafeTextContent(path, mimeType);
}

export function uint24Le(buffer, offset) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

export function imageDimensions(path, mimeType) {
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

export function attachmentSourceType(file) {
  const source = String(file?.fields?.source_type || "upload");
  if (source === "device_capture") return "device_capture";
  return "upload";
}

export function annotationOperationsFromField(value) {
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

export function mapTenant(row) {
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

export function mapUser(row) {
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

export function mapCustomer(row) {
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

export function mapItem(row, ownerKey) {
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

export function mapEstimate(row, items = []) {
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

export function mapOrder(row, items = []) {
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
  Object.assign(order, deriveOrderProductionSummary(items));
  return order;
}

export function mapInvoice(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      order_id: row.order_id,
      customer_id: row.customer_id,
      customer_summary: row.customer_contact_name || row.customer_business_name ? {
        contact_name: row.customer_contact_name || null,
        business_name: row.customer_business_name || null,
      } : null,
      order_number: row.order_number || null,
      order_title: row.order_title || null,
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

export function mapAttachment(row) {
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

export function mapEmailSettings(row, tenant = null) {
  return {
    sender_name: row?.sender_name || tenant?.company_name || "",
    sender_email: row?.sender_email || tenant?.contact_email || null,
    sendgrid_verified: Boolean(row?.sendgrid_verified),
    configured: Boolean(row?.sender_email || tenant?.contact_email),
    provider_ready: Boolean(process.env.SIGNGUY_SLIM_SENDGRID_API_KEY),
    updated_at: row?.updated_at || null,
  };
}

export function mapOutboundEmail(row) {
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

export function mapCommunication(row) {
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

export function mapIntakeAddress(row) {
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

export function mapIntakeMessage(row) {
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

export function mapIntakeItem(row, source = null, attachments = []) {
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

export function mapIntakeAttachment(row) {
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

export function sanitizeHtmlFragment(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function hmacHex(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySharedSecretSignature({ secret, payload, signature, required, errorCode }) {
  if (!secret) {
    if (required) throw error(errorCode, 401);
    return true;
  }
  const expected = hmacHex(secret, payload);
  if (!signature || expected !== String(signature).replace(/^sha256=/, "")) throw error(errorCode, 401);
  return true;
}

export function mapCalendarEvent(row, tenant = null) {
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

export function mapWorkOrder(row, items = [], schedules = []) {
  if (!row) return null;
  const state = normalizeWorkOrderState(row);
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      order_id: row.order_id,
      work_order_number: row.work_order_number,
      title: fallbackOrderTitle(row),
      grouping_mode: row.grouping_mode,
      production_stage: state.production_stage,
      completed: state.completed,
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
      items: items.map((item) => ({ ...item, ...deriveOrderItemProductionState(item, state) })),
      scheduled_entries: schedules,
    },
    ["completed"],
  );
}

export function mapBundle(row, items = []) {
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

export function mapDepartment(row, memberships = []) {
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

export function mapResource(row, unavailable = []) {
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

export function mapScheduleView(row) {
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

