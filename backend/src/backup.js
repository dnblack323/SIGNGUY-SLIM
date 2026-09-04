import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { durableWriteFile, trySyncDirectory } from "./durableFiles.js";

const BACKUP_SIGNATURE = "SIGNGUY-SLIM-BACKUP";
const CONTAINER_VERSION = "1.0.0";
const FORMAT_VERSION = "signguy-slim-backup-v1";
const PORTABLE_CONTRACT_VERSION = "1.0.0";
const PRODUCT = "SIGNGUY-SLIM";
const KDF = "PBKDF2-HMAC-SHA256";
const KDF_ITERATIONS = 310000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const EXPECTED_DATA_SECTIONS = [
  "tenants", "users", "customers", "estimates", "estimate_items", "orders", "order_items", "work_orders", "work_order_items", "invoices", "calendar_events",
  "employees", "employee_rates", "employee_time_entries", "employee_pay_weeks", "employee_pay_advances", "employee_pay_adjustments", "employee_pay_manual_payments",
  "employee_announcements", "employee_announcement_reads", "employee_direct_messages",
  "tenant_sequences", "reminders", "notes", "audit_events",
];
const EXPECTED_RECORD_COUNT_KEYS = [...EXPECTED_DATA_SECTIONS, "attachments"];
const COMPAT_OPTIONAL_DATA_SECTIONS = new Set(["work_orders", "work_order_items", "employee_announcements", "employee_announcement_reads", "employee_direct_messages"]);
const REQUIRED_DATA_SECTIONS = EXPECTED_DATA_SECTIONS.filter((section) => !COMPAT_OPTIONAL_DATA_SECTIONS.has(section));
const GROUP_C_SCHEMA_VERSION = "014_hardening_production_source_of_truth.sql";
const STAGE_7_8_SCHEMA_VERSION = "013_v2_stage7_8_messages_announcements.sql";
const STAGE_5_6_SCHEMA_VERSION = "012_v2_stage5_6_time_pay.sql";
const PRODUCTION_STAGES = new Set(["not_started", "ready", "in_progress", "waiting", "complete"]);
const OPERATIONAL_TABLES = [
  "customers",
  "estimates",
  "estimate_items",
  "orders",
  "order_items",
  "work_orders",
  "work_order_items",
  "invoices",
  "calendar_events",
  "order_attachments",
  "employees",
  "employee_rates",
  "employee_time_entries",
  "employee_pay_weeks",
  "employee_pay_advances",
  "employee_pay_adjustments",
  "employee_pay_manual_payments",
  "employee_announcements",
  "employee_announcement_reads",
  "employee_direct_messages",
];
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

function now() {
  return new Date().toISOString();
}

function backupError(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function deriveKey(passphrase, salt) {
  return pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KEY_BYTES, "sha256");
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 256) {
    throw backupError("backup_passphrase_invalid", 400);
  }
}

function sanitizeFilename(value) {
  return String(value || "signguy-slim")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "signguy-slim";
}

function fileExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

function assertUnique(values, code) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw backupError(code, 400);
    seen.add(value);
  }
}

function assertAllowedObjectKeys(object, allowed, code) {
  for (const key of Object.keys(object || {})) {
    if (!allowed.includes(key)) throw backupError(code, 400);
  }
}

function assertSafePackagePath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw backupError("backup_path_invalid", 400);
  }
}

function assertSafeAttachmentBytes(bytes, mimeType, filename) {
  const safe = basename(String(filename || "attachment").replace(/\\/g, "/"));
  if (!safe || safe !== filename || BLOCKED_EXTENSION_RE.test(safe)) throw backupError("backup_attachment_type_unsupported", 400);
  const extension = fileExtension(safe);
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType) || !MIME_EXTENSIONS[mimeType]?.has(extension)) {
    throw backupError("backup_attachment_type_unsupported", 400);
  }
  if (mimeType === "application/pdf" && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw backupError("backup_attachment_type_unsupported", 400);
  if (mimeType === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw backupError("backup_attachment_type_unsupported", 400);
  if (mimeType === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw backupError("backup_attachment_type_unsupported", 400);
  if (mimeType === "image/gif" && !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("latin1"))) throw backupError("backup_attachment_type_unsupported", 400);
  if (mimeType === "image/webp" && !(bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")) throw backupError("backup_attachment_type_unsupported", 400);
  if (["text/plain", "text/csv", "application/json"].includes(mimeType)) {
    if (bytes.includes(0)) throw backupError("backup_attachment_type_unsupported", 400);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw backupError("backup_attachment_type_unsupported", 400);
    }
    if (/^(<!doctype\s+html|<html\b|<script\b|<svg\b|<\?xml)/i.test(text.trimStart())) throw backupError("backup_attachment_type_unsupported", 400);
    if (mimeType === "application/json") {
      try {
        JSON.parse(text);
      } catch {
        throw backupError("backup_attachment_type_unsupported", 400);
      }
    }
  }
}

function selectAll(db, table, tenantId, order = "created_at, id") {
  return db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY ${order}`).all(tenantId);
}

function activeAttachments(db, tenantId) {
  return db
    .prepare("SELECT * FROM order_attachments WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at, id")
    .all(tenantId);
}

function userSafe(row) {
  const { password_hash, ...safe } = row;
  return { ...safe, email_label: row.email };
}

function dataFile(path, value) {
  const bytes = jsonBuffer(value);
  return { path, media_type: "application/json", size_bytes: bytes.length, sha256: sha256Buffer(bytes) };
}

function getSchemaVersion(db) {
  return db.prepare("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1").get()?.id || "unmigrated";
}

function compatibleSchemaVersion(currentSchemaVersion, sourceSchemaVersion) {
  if (sourceSchemaVersion === currentSchemaVersion) return true;
  if (currentSchemaVersion === GROUP_C_SCHEMA_VERSION) {
    return [STAGE_7_8_SCHEMA_VERSION, STAGE_5_6_SCHEMA_VERSION].includes(sourceSchemaVersion);
  }
  return currentSchemaVersion === STAGE_7_8_SCHEMA_VERSION && sourceSchemaVersion === STAGE_5_6_SCHEMA_VERSION;
}

function carriesWorkOrderSections(payload) {
  const inventoryPaths = new Set((payload?.manifest?.data_file_inventory || []).map((entry) => entry.path));
  return inventoryPaths.has("data/work_orders.json") && inventoryPaths.has("data/work_order_items.json");
}

function buildSnapshot(service, actor) {
  const db = service.db;
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(actor.tenant_id);
  const data = {
    tenants: [tenant],
    users: selectAll(db, "users", actor.tenant_id, "display_name, id").map(userSafe),
    customers: selectAll(db, "customers", actor.tenant_id, "customer_number, id"),
    estimates: selectAll(db, "estimates", actor.tenant_id, "estimate_number, id"),
    estimate_items: selectAll(db, "estimate_items", actor.tenant_id, "estimate_id, position, id"),
    orders: selectAll(db, "orders", actor.tenant_id, "order_number, id"),
    order_items: selectAll(db, "order_items", actor.tenant_id, "order_id, position, id"),
    work_orders: selectAll(db, "work_orders", actor.tenant_id, "work_order_number, id"),
    work_order_items: selectAll(db, "work_order_items", actor.tenant_id, "work_order_id, position, id"),
    invoices: selectAll(db, "invoices", actor.tenant_id, "invoice_number, id"),
    calendar_events: selectAll(db, "calendar_events", actor.tenant_id, "start_at, id"),
    employees: selectAll(db, "employees", actor.tenant_id, "employee_number, id"),
    employee_rates: selectAll(db, "employee_rates", actor.tenant_id, "employee_id, effective_date, id"),
    employee_time_entries: selectAll(db, "employee_time_entries", actor.tenant_id, "employee_id, clock_in_at, id"),
    employee_pay_weeks: selectAll(db, "employee_pay_weeks", actor.tenant_id, "employee_id, week_start_date, id"),
    employee_pay_advances: selectAll(db, "employee_pay_advances", actor.tenant_id, "employee_id, pay_week_start, created_at, id"),
    employee_pay_adjustments: selectAll(db, "employee_pay_adjustments", actor.tenant_id, "employee_id, pay_week_start, created_at, id"),
    employee_pay_manual_payments: selectAll(db, "employee_pay_manual_payments", actor.tenant_id, "employee_id, pay_week_start, created_at, id"),
    employee_announcements: selectAll(db, "employee_announcements", actor.tenant_id, "publish_at, id"),
    employee_announcement_reads: selectAll(db, "employee_announcement_reads", actor.tenant_id, "read_at, id"),
    employee_direct_messages: selectAll(db, "employee_direct_messages", actor.tenant_id, "sent_at, id"),
    tenant_sequences: db.prepare("SELECT * FROM tenant_sequences WHERE tenant_id = ? ORDER BY sequence_name").all(actor.tenant_id),
    reminders: [],
    notes: [],
    audit_events: selectAll(db, "audit_events", actor.tenant_id, "occurred_at, id").map((row) => ({
      ...row,
      diff_json: row.diff_json ? "[redacted-for-backup-provenance]" : null,
    })),
  };
  const attachments = activeAttachments(db, actor.tenant_id).map((row) => {
    const path = service.attachmentPath(row.storage_key);
    if (!existsSync(path)) throw backupError("attachment_file_missing", 404);
    const bytes = readFileSync(path);
    if (bytes.length !== row.byte_size || sha256Buffer(bytes) !== row.sha256) throw backupError("attachment_integrity_mismatch", 409);
    return {
      metadata: row,
      logical_path: `attachments/${row.portable_id}-${sanitizeFilename(row.original_filename)}`,
      content_base64: bytes.toString("base64"),
    };
  });
  return { tenant, data, attachments };
}

function buildManifest(snapshot) {
  const backupId = `sgp_v1_backup_${randomUUID()}`;
  const dataInventories = Object.entries(snapshot.data).map(([name, value]) => dataFile(`data/${name}.json`, value));
  const attachmentInventory = snapshot.attachments.map((entry) => {
    const bytes = Buffer.from(entry.content_base64, "base64");
    return {
      path: entry.logical_path,
      content_type: entry.metadata.mime_type,
      size_bytes: bytes.length,
      sha256: sha256Buffer(bytes),
      source_portable_id: entry.metadata.portable_id,
    };
  });
  const recordCounts = Object.fromEntries(Object.entries(snapshot.data).map(([name, value]) => [name, value.length]));
  recordCounts.attachments = snapshot.attachments.length;
  const manifestCore = {
    backup_id: backupId,
    backup_format_version: FORMAT_VERSION,
    portable_contract_version: PORTABLE_CONTRACT_VERSION,
    source_product: PRODUCT,
    source_application_version: process.env.npm_package_version || "0.2.0-v2-stage8",
    source_commit: process.env.SIGNGUY_SLIM_COMMIT_SHA || process.env.GITHUB_SHA || "unknown",
    source_schema_version: getSchemaVersion(snapshot.serviceDb || { prepare: () => ({ get: () => null }) }),
    source_tenant_identifier: snapshot.tenant.portable_id,
    created_at_utc: now(),
    record_counts: recordCounts,
    attachment_count: snapshot.attachments.length,
    total_attachment_bytes: attachmentInventory.reduce((sum, item) => sum + item.size_bytes, 0),
    data_file_inventory: dataInventories,
    attachment_inventory: attachmentInventory,
    minimum_compatible_restore_version: "0.1.0-v1-part5",
    contains_secrets: false,
  };
  const integrityInput = jsonBuffer({ data: snapshot.data, attachments: attachmentInventory });
  return {
    ...manifestCore,
    overall_backup_integrity: `sha256:${sha256Buffer(integrityInput)}`,
  };
}

export function createEncryptedBackup(service, actor, body) {
  service.requireBackupRole(actor);
  const passphrase = String(body?.passphrase || "");
  assertPassphrase(passphrase);
  if (body?.passphrase_confirmation !== undefined && body.passphrase_confirmation !== passphrase) {
    throw backupError("backup_passphrase_mismatch", 400);
  }
  return service.transaction(() => {
    const snapshot = buildSnapshot(service, actor);
    snapshot.serviceDb = service.db;
    const manifest = buildManifest(snapshot);
    const payload = { manifest, data: snapshot.data, attachments: snapshot.attachments };
    const salt = randomBytes(SALT_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const aad = {
      signature: BACKUP_SIGNATURE,
      container_version: CONTAINER_VERSION,
      algorithm: "AES-256-GCM",
      kdf: KDF,
      kdf_iterations: KDF_ITERATIONS,
    };
    const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), nonce);
    cipher.setAAD(jsonBuffer(aad));
    const ciphertext = Buffer.concat([cipher.update(jsonBuffer(payload)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const container = {
      ...aad,
      salt_b64: salt.toString("base64"),
      nonce_b64: nonce.toString("base64"),
      tag_b64: tag.toString("base64"),
      ciphertext_b64: ciphertext.toString("base64"),
    };
    const bytes = jsonBuffer(container);
    if (bytes.length > MAX_BACKUP_BYTES) throw backupError("backup_file_too_large", 413);
    service.audit(actor, "backup.requested", "tenant", actor.tenant_id, snapshot.tenant.portable_id, "Slim backup requested", { backup_id: manifest.backup_id });
    service.audit(actor, "backup.completed", "tenant", actor.tenant_id, snapshot.tenant.portable_id, "Encrypted Slim backup completed", {
      backup_id: manifest.backup_id,
      record_counts: manifest.record_counts,
      attachment_count: manifest.attachment_count,
    });
    service.audit(actor, "backup.download", "tenant", actor.tenant_id, snapshot.tenant.portable_id, "Encrypted Slim backup response prepared for download", { backup_id: manifest.backup_id });
    return {
      buffer: bytes,
      filename: `${sanitizeFilename(snapshot.tenant.company_name)}-${manifest.created_at_utc.slice(0, 10)}.signguy-backup`,
      manifest,
    };
  });
}

export function decryptBackup(buffer, passphrase) {
  assertPassphrase(passphrase);
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BACKUP_BYTES) throw backupError("backup_file_too_large", 413);
  let container;
  try {
    container = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw backupError("backup_container_unrecognized", 400);
  }
  assertAllowedObjectKeys(container, ["signature", "container_version", "algorithm", "kdf", "kdf_iterations", "salt_b64", "nonce_b64", "tag_b64", "ciphertext_b64"], "backup_container_unrecognized");
  if (container.signature !== BACKUP_SIGNATURE || container.container_version !== CONTAINER_VERSION) {
    throw backupError("backup_container_unrecognized", 400);
  }
  if (container.algorithm !== "AES-256-GCM" || container.kdf !== KDF || container.kdf_iterations !== KDF_ITERATIONS) {
    throw backupError("backup_format_unsupported", 400);
  }
  try {
    const salt = Buffer.from(String(container.salt_b64 || ""), "base64");
    const nonce = Buffer.from(String(container.nonce_b64 || ""), "base64");
    const tag = Buffer.from(String(container.tag_b64 || ""), "base64");
    const ciphertext = Buffer.from(String(container.ciphertext_b64 || ""), "base64");
    if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length < 1 || ciphertext.length > MAX_BACKUP_BYTES) {
      throw backupError("backup_container_unrecognized", 400);
    }
    const aad = {
      signature: container.signature,
      container_version: container.container_version,
      algorithm: container.algorithm,
      kdf: container.kdf,
      kdf_iterations: container.kdf_iterations,
    };
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), nonce);
    decipher.setAAD(jsonBuffer(aad));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw backupError("backup_decryption_failed", 400);
  }
}

function validatePayload(payload) {
  const manifest = payload?.manifest;
  if (!manifest || manifest.source_product !== PRODUCT || manifest.backup_format_version !== FORMAT_VERSION) {
    throw backupError("backup_format_unsupported", 400);
  }
  assertAllowedObjectKeys(payload, ["manifest", "data", "attachments"], "backup_manifest_malformed");
  if (manifest.contains_secrets !== false) throw backupError("backup_contains_secrets", 400);
  for (const key of ["data", "attachments"]) {
    if (!payload[key]) throw backupError("backup_manifest_missing", 400);
  }
  assertAllowedObjectKeys(payload.data, EXPECTED_DATA_SECTIONS, "backup_manifest_malformed");
  const integrityData = { ...payload.data };
  for (const section of REQUIRED_DATA_SECTIONS) {
    if (!Array.isArray(payload.data[section])) throw backupError("backup_manifest_malformed", 400);
  }
  for (const section of COMPAT_OPTIONAL_DATA_SECTIONS) {
    if (payload.data[section] === undefined) payload.data[section] = [];
    if (!Array.isArray(payload.data[section])) throw backupError("backup_manifest_malformed", 400);
  }
  if (!Array.isArray(payload.attachments) || payload.data.tenants.length !== 1) throw backupError("backup_manifest_malformed", 400);
  const counts = Object.fromEntries(Object.entries(payload.data).map(([name, records]) => [name, records.length]));
  counts.attachments = payload.attachments.length;
  assertAllowedObjectKeys(manifest.record_counts || {}, EXPECTED_RECORD_COUNT_KEYS, "backup_manifest_malformed");
  const expectedRecordCountKeys = [...REQUIRED_DATA_SECTIONS, ...[...COMPAT_OPTIONAL_DATA_SECTIONS].filter((section) => Object.prototype.hasOwnProperty.call(manifest.record_counts || {}, section)), "attachments"];
  for (const name of expectedRecordCountKeys) {
    const count = manifest.record_counts?.[name];
    if (!Number.isInteger(count) || count < 0) throw backupError("backup_record_count_mismatch", 400);
    if (counts[name] !== count) throw backupError("backup_record_count_mismatch", 400);
  }
  const inventoryPaths = new Set((manifest.data_file_inventory || []).map((entry) => entry.path));
  const sourceHasWorkOrders = carriesWorkOrderSections(payload);
  const expectedDataSections = EXPECTED_DATA_SECTIONS.filter((section) => !COMPAT_OPTIONAL_DATA_SECTIONS.has(section) || inventoryPaths.has(`data/${section}.json`));
  const expectedDataFiles = new Map(expectedDataSections.map((section) => [`data/${section}.json`, dataFile(`data/${section}.json`, payload.data[section])]));
  if (!Array.isArray(manifest.data_file_inventory) || manifest.data_file_inventory.length !== expectedDataFiles.size) throw backupError("backup_manifest_malformed", 400);
  assertUnique(manifest.data_file_inventory.map((entry) => entry.path), "backup_manifest_malformed");
  for (const entry of manifest.data_file_inventory) {
    assertSafePackagePath(entry.path);
    const expected = expectedDataFiles.get(entry.path);
    if (!expected || entry.media_type !== expected.media_type || entry.size_bytes !== expected.size_bytes || entry.sha256 !== expected.sha256) {
      throw backupError("backup_checksum_mismatch", 400);
    }
  }
  if (!Array.isArray(manifest.attachment_inventory)) throw backupError("backup_manifest_malformed", 400);
  assertUnique(manifest.attachment_inventory.map((entry) => entry.path), "backup_manifest_malformed");
  assertUnique(manifest.attachment_inventory.map((entry) => entry.source_portable_id), "backup_manifest_malformed");
  const inventory = new Map(manifest.attachment_inventory.map((entry) => {
    assertSafePackagePath(entry.path);
    return [entry.source_portable_id, entry];
  }));
  if (inventory.size !== payload.attachments.length) throw backupError("backup_attachment_missing", 400);
  const sourceTenantId = payload.data.tenants[0].id;
  for (const section of ["users", "customers", "estimates", "estimate_items", "orders", "order_items", "work_orders", "work_order_items", "invoices", "calendar_events", "employees", "employee_rates", "employee_time_entries", "employee_pay_weeks", "employee_pay_advances", "employee_pay_adjustments", "employee_pay_manual_payments", "employee_announcements", "employee_announcement_reads", "employee_direct_messages", "tenant_sequences", "audit_events"]) {
    for (const row of payload.data[section]) {
      if (row.tenant_id !== sourceTenantId) throw backupError("backup_relationship_invalid", 400);
    }
  }
  if (payload.data.users.some((row) => Object.prototype.hasOwnProperty.call(row, "password_hash"))) throw backupError("backup_contains_secrets", 400);
  const users = new Set(payload.data.users.map((row) => row.id));
  const customers = new Set(payload.data.customers.map((row) => row.id));
  const estimates = new Set(payload.data.estimates.map((row) => row.id));
  const estimateItems = new Set(payload.data.estimate_items.map((row) => row.id));
  const orders = new Set(payload.data.orders.map((row) => row.id));
  const orderItems = new Set(payload.data.order_items.map((row) => row.id));
  const workOrders = new Set(payload.data.work_orders.map((row) => row.id));
  const workOrderOrders = new Map(payload.data.work_orders.map((row) => [row.id, row.order_id]));
  const workOrderStatuses = new Map(payload.data.work_orders.map((row) => [row.id, row.status]));
  const orderItemOrders = new Map(payload.data.order_items.map((row) => [row.id, row.order_id]));
  const employees = new Set(payload.data.employees.map((row) => row.id));
  const announcements = new Set(payload.data.employee_announcements.map((row) => row.id));
  const employeeUserIds = new Map(payload.data.employees.map((row) => [row.id, row.user_id]));
  const employeeUserIdValues = new Set(employeeUserIds.values());
  assertUnique(payload.data.users.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.customers.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.estimates.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.estimate_items.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.orders.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.order_items.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.work_orders.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.work_order_items.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.employees.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.employee_announcements.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.employee_announcement_reads.map((row) => row.id), "backup_relationship_invalid");
  assertUnique(payload.data.employee_announcement_reads.map((row) => `${row.announcement_id}:${row.employee_id}`), "backup_relationship_invalid");
  assertUnique(payload.data.employee_direct_messages.map((row) => row.id), "backup_relationship_invalid");
  for (const row of payload.data.estimates) {
    if (!customers.has(row.customer_id) || (row.converted_order_id && !orders.has(row.converted_order_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.estimate_items) {
    if (!estimates.has(row.estimate_id) || (row.assigned_user_id && !users.has(row.assigned_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.orders) {
    if (!customers.has(row.customer_id) || (row.source_estimate_id && !estimates.has(row.source_estimate_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.order_items) {
    if (!orders.has(row.order_id) || (row.source_estimate_item_id && !estimateItems.has(row.source_estimate_item_id)) || (row.assigned_user_id && !users.has(row.assigned_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  const activeWorkOrderItems = new Set();
  const activeWorkOrderItemLinks = new Set();
  for (const row of payload.data.work_orders) {
    const stageComplete = row.production_stage === "complete";
    if (!orders.has(row.order_id) || (row.created_by_user_id && !users.has(row.created_by_user_id)) || (row.assigned_user_id && !users.has(row.assigned_user_id))) throw backupError("backup_relationship_invalid", 400);
    if (!PRODUCTION_STAGES.has(row.production_stage) || !["active", "cancelled"].includes(row.status)) throw backupError("backup_relationship_invalid", 400);
    if (Boolean(row.completed) !== stageComplete) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.work_order_items) {
    if (!workOrders.has(row.work_order_id) || !orderItems.has(row.order_item_id) || workOrderOrders.get(row.work_order_id) !== orderItemOrders.get(row.order_item_id)) throw backupError("backup_relationship_invalid", 400);
    const item = payload.data.order_items.find((entry) => entry.id === row.order_item_id);
    if (!item?.production_required) throw backupError("backup_relationship_invalid", 400);
    if (row.active) {
      if (workOrderStatuses.get(row.work_order_id) !== "active") throw backupError("backup_relationship_invalid", 400);
      if (activeWorkOrderItems.has(row.order_item_id)) throw backupError("backup_relationship_invalid", 400);
      activeWorkOrderItems.add(row.order_item_id);
      activeWorkOrderItemLinks.add(`${row.work_order_id}:${row.order_item_id}`);
    }
  }
  for (const row of payload.data.invoices) {
    if (!orders.has(row.order_id) || !customers.has(row.customer_id)) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.calendar_events) {
    if ((row.order_id && !orders.has(row.order_id)) || (row.order_item_id && !orderItems.has(row.order_item_id)) || (row.work_order_id && sourceHasWorkOrders && !workOrders.has(row.work_order_id)) || (row.assigned_user_id && !users.has(row.assigned_user_id)) || !users.has(row.created_by_user_id)) {
      throw backupError("backup_relationship_invalid", 400);
    }
    if (row.work_order_id && sourceHasWorkOrders) {
      if (row.order_id && workOrderOrders.get(row.work_order_id) !== row.order_id) throw backupError("backup_relationship_invalid", 400);
      if (row.order_item_id && workOrderStatuses.get(row.work_order_id) === "active" && !activeWorkOrderItemLinks.has(`${row.work_order_id}:${row.order_item_id}`)) {
        throw backupError("backup_relationship_invalid", 400);
      }
    }
  }
  for (const row of payload.data.employees) {
    if (!users.has(row.user_id)) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_rates) {
    if (!employees.has(row.employee_id) || !users.has(row.created_by_user_id)) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_time_entries) {
    if (!employees.has(row.employee_id) || !users.has(row.created_by_user_id) || (row.corrected_by_user_id && !users.has(row.corrected_by_user_id)) || (row.voided_by_user_id && !users.has(row.voided_by_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_pay_weeks) {
    if (!employees.has(row.employee_id) || (row.closed_by_user_id && !users.has(row.closed_by_user_id)) || (row.reopened_by_user_id && !users.has(row.reopened_by_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_pay_advances) {
    if (!employees.has(row.employee_id) || !users.has(row.created_by_user_id) || (row.voided_by_user_id && !users.has(row.voided_by_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_pay_adjustments) {
    if (!employees.has(row.employee_id) || !users.has(row.created_by_user_id) || (row.voided_by_user_id && !users.has(row.voided_by_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_pay_manual_payments) {
    if (!employees.has(row.employee_id) || !users.has(row.recorded_by_user_id) || (row.voided_by_user_id && !users.has(row.voided_by_user_id))) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_announcements) {
    if (!users.has(row.author_user_id) || (row.archived_by_user_id && !users.has(row.archived_by_user_id)) || !["all", "owner", "admin", "manager", "staff"].includes(row.audience_role)) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_announcement_reads) {
    if (!announcements.has(row.announcement_id) || !employees.has(row.employee_id) || !users.has(row.user_id) || employeeUserIds.get(row.employee_id) !== row.user_id) throw backupError("backup_relationship_invalid", 400);
  }
  for (const row of payload.data.employee_direct_messages) {
    if (!users.has(row.sender_user_id) || !users.has(row.recipient_user_id) || !employeeUserIdValues.has(row.sender_user_id) || !employeeUserIdValues.has(row.recipient_user_id) || row.sender_user_id === row.recipient_user_id) throw backupError("backup_relationship_invalid", 400);
  }
  let attachmentBytes = 0;
  for (const attachment of payload.attachments) {
    const bytes = Buffer.from(attachment.content_base64 || "", "base64");
    const entry = inventory.get(attachment.metadata?.portable_id);
    if (!entry) throw backupError("backup_attachment_missing", 400);
    if (attachment.metadata?.tenant_id !== sourceTenantId) throw backupError("backup_relationship_invalid", 400);
    if (!orders.has(attachment.metadata?.order_id)) throw backupError("backup_relationship_invalid", 400);
    if (attachment.metadata?.created_by_user_id && !users.has(attachment.metadata.created_by_user_id)) throw backupError("backup_relationship_invalid", 400);
    if (entry.content_type !== attachment.metadata.mime_type || entry.size_bytes !== attachment.metadata.byte_size || attachment.metadata.sha256 !== entry.sha256) {
      throw backupError("backup_checksum_mismatch", 400);
    }
    if (entry.size_bytes !== bytes.length || entry.sha256 !== sha256Buffer(bytes)) {
      throw backupError("backup_checksum_mismatch", 400);
    }
    assertSafeAttachmentBytes(bytes, attachment.metadata.mime_type, attachment.metadata.original_filename);
    attachmentBytes += bytes.length;
  }
  const attachmentIds = new Set(payload.attachments.map((entry) => entry.metadata?.id));
  for (const attachment of payload.attachments) {
    const metadata = attachment.metadata || {};
    if (metadata.original_attachment_id && (!attachmentIds.has(metadata.original_attachment_id) || metadata.original_attachment_id === metadata.id)) throw backupError("backup_relationship_invalid", 400);
    if (metadata.original_attachment_id && (metadata.source_type !== "annotation_derivative" || metadata.derivative_type !== "annotation" || !metadata.annotation_json)) throw backupError("backup_relationship_invalid", 400);
  }
  if (manifest.attachment_count !== payload.attachments.length || manifest.total_attachment_bytes !== attachmentBytes) throw backupError("backup_record_count_mismatch", 400);
  const integrityInput = jsonBuffer({ data: integrityData, attachments: manifest.attachment_inventory });
  if (manifest.overall_backup_integrity !== `sha256:${sha256Buffer(integrityInput)}`) throw backupError("backup_checksum_mismatch", 400);
  return payload;
}

function targetOperationalCounts(db, tenantId) {
  return Object.fromEntries(OPERATIONAL_TABLES.map((table) => {
    const clause = table === "order_attachments" ? "tenant_id = ? AND deleted_at IS NULL" : "tenant_id = ?";
    return [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${clause}`).get(tenantId).count];
  }));
}

function assignmentPreview(service, actor, payload) {
  const targetUsers = service.users(actor);
  const byEmail = new Map(targetUsers.map((user) => [user.email.toLowerCase(), user]));
  return (payload.data.users || []).map((source) => {
    const target = byEmail.get(String(source.email_label || "").toLowerCase());
    return {
      source_user_portable_id: source.portable_id,
      source_display_name: source.display_name,
      source_email_label: source.email_label,
      matched_target_user_id: target?.id || null,
      matched_target_display_name: target?.display_name || null,
      matched: Boolean(target),
    };
  });
}

function restorePreviewFromPayload(service, actor, payload) {
  const emptiness = targetOperationalCounts(service.db, actor.tenant_id);
  const blocking_errors = Object.entries(emptiness).filter(([, count]) => count > 0).map(([resource, count]) => `${resource}:${count}`);
  const currentSchemaVersion = getSchemaVersion(service.db);
  if (!compatibleSchemaVersion(currentSchemaVersion, payload.manifest.source_schema_version)) blocking_errors.push("schema_incompatible");
  const duplicate = service.db
    .prepare("SELECT id FROM backup_restore_receipts WHERE target_tenant_id = ? AND backup_id = ? AND status = 'completed'")
    .get(actor.tenant_id, payload.manifest.backup_id);
  if (duplicate) blocking_errors.push("duplicate_backup");
  const user_mapping = assignmentPreview(service, actor, payload);
  const unmatched = user_mapping.filter((entry) => !entry.matched);
  const employeeUserIds = new Set((payload.data.employees || []).map((row) => row.user_id));
  const usersById = new Map((payload.data.users || []).map((row) => [row.id, row]));
  const employeeUnmatched = unmatched.filter((entry) => employeeUserIds.has([...usersById.values()].find((user) => user.portable_id === entry.source_user_portable_id)?.id));
  if (employeeUnmatched.length) blocking_errors.push("employee_user_mapping_required");
  const warnings = unmatched.map((entry) => `Unmatched assignment user ${entry.source_email_label}; restore can keep those assignments unassigned with explicit confirmation.`);
  return {
    backup_id: payload.manifest.backup_id,
    created_at_utc: payload.manifest.created_at_utc,
    source_product: payload.manifest.source_product,
    source_application_version: payload.manifest.source_application_version,
    source_schema_version: payload.manifest.source_schema_version,
    counts: payload.manifest.record_counts,
    attachment_count: payload.manifest.attachment_count,
    total_attachment_bytes: payload.manifest.total_attachment_bytes,
    user_mapping,
    warnings,
    blocking_errors,
    restore_permitted: blocking_errors.length === 0,
    required_unmatched_assignment_policy: unmatched.length ? "restore_unassigned" : null,
  };
}

export function previewBackup(service, actor, file, passphrase) {
  try {
    service.requireBackupRole(actor);
    const payload = validatePayload(decryptBackup(readFileSync(file.temp_path), passphrase));
    const preview = restorePreviewFromPayload(service, actor, payload);
    service.audit(actor, "backup.validation", "tenant", actor.tenant_id, service.tenant(actor.tenant_id).portable_id, "Slim backup validation attempted", {
      backup_id: preview.backup_id,
      restore_permitted: preview.restore_permitted,
      blocking_error_count: preview.blocking_errors.length,
    });
    return preview;
  } finally {
    if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
  }
}

function mapId(sourceRows, makeId = randomUUID) {
  return new Map(sourceRows.map((row) => [row.id, makeId()]));
}

function maxSequenceValue(records, column, prefix) {
  let max = 0;
  for (const record of records || []) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(String(record[column] || ""));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function insertRows(db, table, rows, columns) {
  if (!rows.length) return;
  const placeholders = columns.map(() => "?").join(", ");
  const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
  for (const row of rows) stmt.run(...columns.map((column) => row[column] ?? null));
}

function portable(type) {
  return `sgp_v1_${type}_${randomUUID()}`;
}

function localPortable(db, table, type, originalPortableId) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE portable_id = ?`).get(originalPortableId);
  return existing ? portable(type) : originalPortableId;
}

export function restoreBackup(service, actor, file, body) {
  const target = service.tenant(actor.tenant_id);
  const started = now();
  const stagedPaths = [];
  let payload = null;
  let preview = null;
  try {
    service.requireBackupRole(actor);
    payload = validatePayload(decryptBackup(readFileSync(file.temp_path), String(body?.passphrase || "")));
    preview = restorePreviewFromPayload(service, actor, payload);
    if (!preview.restore_permitted) throw backupError("backup_restore_blocked", 409);
    if (String(body?.confirmation_phrase || "") !== target.company_name) throw backupError("backup_confirmation_required", 400);
    if (preview.required_unmatched_assignment_policy && body?.unmatched_assignment_policy !== "restore_unassigned") {
      throw backupError("backup_assignment_policy_required", 400);
    }
    service.audit(actor, "backup.restore_confirmed", "tenant", actor.tenant_id, target.portable_id, "Slim backup restore confirmed", { backup_id: payload.manifest.backup_id });
    const result = service.transaction(() => {
      if (!restorePreviewFromPayload(service, actor, payload).restore_permitted) throw backupError("backup_restore_blocked", 409);
      const tenantId = actor.tenant_id;
      const source = payload.data;
      const userMap = new Map();
      for (const match of preview.user_mapping) if (match.matched_target_user_id) userMap.set(match.source_user_portable_id, match.matched_target_user_id);
      const idMaps = {
        customers: mapId(source.customers),
        estimates: mapId(source.estimates),
        estimate_items: mapId(source.estimate_items),
        orders: mapId(source.orders),
        order_items: mapId(source.order_items),
        work_orders: mapId(source.work_orders),
        work_order_items: mapId(source.work_order_items),
        invoices: mapId(source.invoices),
        calendar_events: mapId(source.calendar_events),
        employees: mapId(source.employees),
        employee_rates: mapId(source.employee_rates),
        employee_time_entries: mapId(source.employee_time_entries),
        employee_pay_weeks: mapId(source.employee_pay_weeks),
        employee_pay_advances: mapId(source.employee_pay_advances),
        employee_pay_adjustments: mapId(source.employee_pay_adjustments),
        employee_pay_manual_payments: mapId(source.employee_pay_manual_payments),
        employee_announcements: mapId(source.employee_announcements),
        employee_announcement_reads: mapId(source.employee_announcement_reads),
        employee_direct_messages: mapId(source.employee_direct_messages),
        attachments: mapId((payload.attachments || []).map((entry) => entry.metadata)),
      };
      const portableMaps = {
        customers: new Map(source.customers.map((row) => [row.portable_id, localPortable(service.db, "customers", "customer", row.portable_id)])),
        estimates: new Map(source.estimates.map((row) => [row.portable_id, localPortable(service.db, "estimates", "estimate", row.portable_id)])),
        estimate_items: new Map(source.estimate_items.map((row) => [row.portable_id, localPortable(service.db, "estimate_items", "estimate_item", row.portable_id)])),
        orders: new Map(source.orders.map((row) => [row.portable_id, localPortable(service.db, "orders", "order", row.portable_id)])),
        order_items: new Map(source.order_items.map((row) => [row.portable_id, localPortable(service.db, "order_items", "order_item", row.portable_id)])),
        work_orders: new Map(source.work_orders.map((row) => [row.portable_id, localPortable(service.db, "work_orders", "work_order", row.portable_id)])),
        invoices: new Map(source.invoices.map((row) => [row.portable_id, localPortable(service.db, "invoices", "invoice", row.portable_id)])),
        calendar_events: new Map(source.calendar_events.map((row) => [row.portable_id, localPortable(service.db, "calendar_events", "calendar_event", row.portable_id)])),
        employees: new Map(source.employees.map((row) => [row.portable_id, localPortable(service.db, "employees", "employee", row.portable_id)])),
        employee_announcements: new Map(source.employee_announcements.map((row) => [row.portable_id, localPortable(service.db, "employee_announcements", "employee_announcement", row.portable_id)])),
        employee_direct_messages: new Map(source.employee_direct_messages.map((row) => [row.portable_id, localPortable(service.db, "employee_direct_messages", "employee_direct_message", row.portable_id)])),
        attachments: new Map((payload.attachments || []).map((entry) => [entry.metadata.portable_id, localPortable(service.db, "order_attachments", "order_attachment", entry.metadata.portable_id)])),
      };
      const targetUserId = (sourceUserId) => userMap.get(source.users.find((u) => u.id === sourceUserId)?.portable_id) || null;
      const requiredTargetUserId = (sourceUserId) => {
        const mapped = targetUserId(sourceUserId);
        if (!mapped) throw backupError("backup_relationship_invalid", 400);
        return mapped;
      };
      const sourceHasWorkOrders = carriesWorkOrderSections(payload);
      const sourceWorkOrderStatus = new Map(source.work_orders.map((row) => [row.id, row.status]));
      service.db.prepare(
        `UPDATE tenants SET company_name = ?, logo_reference = ?, address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?, country = ?,
         contact_email = ?, contact_phone = ?, sales_tax_rate_basis_points = ?, locale = ?, currency = ?, shop_timezone = ?, updated_at = ? WHERE id = ?`,
      ).run(
        source.tenants[0].company_name,
        source.tenants[0].logo_reference,
        source.tenants[0].address_line1,
        source.tenants[0].address_line2,
        source.tenants[0].city,
        source.tenants[0].state,
        source.tenants[0].postal_code,
        source.tenants[0].country,
        source.tenants[0].contact_email,
        source.tenants[0].contact_phone,
        source.tenants[0].sales_tax_rate_basis_points,
        source.tenants[0].locale,
        source.tenants[0].currency,
        source.tenants[0].shop_timezone,
        now(),
        tenantId,
      );
      insertRows(service.db, "customers", source.customers.map((row) => ({ ...row, id: idMaps.customers.get(row.id), tenant_id: tenantId, portable_id: portableMaps.customers.get(row.portable_id) })), [
        "id", "portable_id", "tenant_id", "customer_number", "contact_name", "business_name", "email", "phone", "billing_line1", "billing_line2", "billing_city", "billing_state", "billing_postal_code", "billing_country", "active", "tax_exempt", "tax_exemption_note", "internal_notes", "created_at", "updated_at",
      ]);
      insertRows(service.db, "estimates", source.estimates.map((row) => ({ ...row, id: idMaps.estimates.get(row.id), tenant_id: tenantId, portable_id: portableMaps.estimates.get(row.portable_id), customer_id: idMaps.customers.get(row.customer_id), converted_order_id: null })), [
        "id", "portable_id", "tenant_id", "customer_id", "estimate_number", "document_date", "expires_at", "follow_up_at", "status", "customer_tax_exempt_snapshot", "tax_rate_basis_points_snapshot", "subtotal_cents", "discount_cents", "tax_cents", "total_cents", "internal_notes", "converted_order_id", "created_at", "updated_at",
      ]);
      insertRows(service.db, "estimate_items", source.estimate_items.map((row) => ({ ...row, id: idMaps.estimate_items.get(row.id), tenant_id: tenantId, portable_id: portableMaps.estimate_items.get(row.portable_id), estimate_id: idMaps.estimates.get(row.estimate_id), assigned_user_id: userMap.get(source.users.find((u) => u.id === row.assigned_user_id)?.portable_id) || null })), [
        "id", "portable_id", "tenant_id", "estimate_id", "position", "description", "quantity_decimal", "unit_price_cents", "line_total_cents", "taxable", "production_required", "due_date", "assigned_user_id", "internal_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "orders", source.orders.map((row) => ({ ...row, id: idMaps.orders.get(row.id), tenant_id: tenantId, portable_id: portableMaps.orders.get(row.portable_id), customer_id: idMaps.customers.get(row.customer_id), source_estimate_id: row.source_estimate_id ? idMaps.estimates.get(row.source_estimate_id) : null, production_grouping_mode: sourceHasWorkOrders ? row.production_grouping_mode : null, sent_to_production_at: sourceHasWorkOrders ? row.sent_to_production_at : null, sent_to_production_by_user_id: sourceHasWorkOrders ? targetUserId(row.sent_to_production_by_user_id) : null })), [
        "id", "portable_id", "tenant_id", "customer_id", "source_estimate_id", "order_number", "document_date", "due_date", "status", "customer_tax_exempt_snapshot", "tax_rate_basis_points_snapshot", "subtotal_cents", "discount_cents", "tax_cents", "total_cents", "internal_notes", "title", "production_grouping_mode", "sent_to_production_at", "sent_to_production_by_user_id", "created_at", "updated_at",
      ]);
      for (const row of source.estimates.filter((entry) => entry.converted_order_id)) {
        service.db.prepare("UPDATE estimates SET converted_order_id = ? WHERE id = ? AND tenant_id = ?").run(idMaps.orders.get(row.converted_order_id), idMaps.estimates.get(row.id), tenantId);
      }
      insertRows(service.db, "order_items", source.order_items.map((row) => ({ ...row, id: idMaps.order_items.get(row.id), tenant_id: tenantId, portable_id: portableMaps.order_items.get(row.portable_id), order_id: idMaps.orders.get(row.order_id), source_estimate_item_id: row.source_estimate_item_id ? idMaps.estimate_items.get(row.source_estimate_item_id) : null, title: row.title || row.description, assigned_user_id: userMap.get(source.users.find((u) => u.id === row.assigned_user_id)?.portable_id) || null, production_stage: "not_started", completed: 0 })), [
        "id", "portable_id", "tenant_id", "order_id", "source_estimate_item_id", "position", "title", "description", "quantity_decimal", "unit_price_cents", "line_total_cents", "taxable", "production_required", "production_stage", "completed", "due_date", "assigned_user_id", "internal_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "work_orders", source.work_orders.map((row) => ({ ...row, id: idMaps.work_orders.get(row.id), tenant_id: tenantId, portable_id: portableMaps.work_orders.get(row.portable_id), order_id: idMaps.orders.get(row.order_id), assigned_user_id: targetUserId(row.assigned_user_id), department_id: null, created_by_user_id: targetUserId(row.created_by_user_id) || actor.id })), [
        "id", "portable_id", "tenant_id", "order_id", "work_order_number", "title", "grouping_mode", "production_stage", "completed", "status", "due_date", "assigned_user_id", "department_id", "instructions_snapshot_json", "created_by_user_id", "sent_to_production_at", "created_at", "updated_at",
      ]);
      insertRows(service.db, "work_order_items", source.work_order_items.map((row) => ({ ...row, id: idMaps.work_order_items.get(row.id), tenant_id: tenantId, work_order_id: idMaps.work_orders.get(row.work_order_id), order_item_id: idMaps.order_items.get(row.order_item_id) })), [
        "id", "tenant_id", "work_order_id", "order_item_id", "position", "active", "created_at",
      ]);
      for (const row of source.orders) service.syncOrderProductionSnapshots(actor, idMaps.orders.get(row.id), now());
      insertRows(service.db, "invoices", source.invoices.map((row) => ({ ...row, id: idMaps.invoices.get(row.id), tenant_id: tenantId, portable_id: portableMaps.invoices.get(row.portable_id), order_id: idMaps.orders.get(row.order_id), customer_id: idMaps.customers.get(row.customer_id) })), [
        "id", "portable_id", "tenant_id", "order_id", "customer_id", "invoice_number", "document_date", "due_date", "document_status", "payment_status", "customer_tax_exempt_snapshot", "tax_rate_basis_points_snapshot", "subtotal_cents", "discount_cents", "tax_cents", "total_cents", "amount_paid_cents", "balance_due_cents", "historical_amount_paid_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "calendar_events", source.calendar_events.map((row) => {
        const workOrderId = row.work_order_id && sourceHasWorkOrders ? idMaps.work_orders.get(row.work_order_id) : null;
        const keepItemLink = !row.work_order_id || !sourceHasWorkOrders || sourceWorkOrderStatus.get(row.work_order_id) === "active";
        return { ...row, id: idMaps.calendar_events.get(row.id), tenant_id: tenantId, portable_id: portableMaps.calendar_events.get(row.portable_id), order_id: row.order_id ? idMaps.orders.get(row.order_id) : null, order_item_id: row.order_item_id && keepItemLink ? idMaps.order_items.get(row.order_item_id) : null, work_order_id: workOrderId, assigned_user_id: userMap.get(source.users.find((u) => u.id === row.assigned_user_id)?.portable_id) || null, created_by_user_id: userMap.get(source.users.find((u) => u.id === row.created_by_user_id)?.portable_id) || actor.id };
      }), [
        "id", "portable_id", "tenant_id", "title", "order_id", "order_item_id", "work_order_id", "start_at", "end_at", "all_day", "assigned_user_id", "status", "internal_note", "created_by_user_id", "created_at", "updated_at",
      ]);
      insertRows(service.db, "employees", source.employees.map((row) => {
        const mappedUserId = targetUserId(row.user_id);
        if (!mappedUserId) throw backupError("backup_relationship_invalid", 400);
        return { ...row, id: idMaps.employees.get(row.id), tenant_id: tenantId, portable_id: portableMaps.employees.get(row.portable_id), user_id: mappedUserId };
      }), [
        "id", "portable_id", "tenant_id", "user_id", "employee_number", "name", "email", "phone", "role", "portal_access_enabled", "pay_management_enabled", "active", "hire_date", "internal_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "employee_rates", source.employee_rates.map((row) => ({ ...row, id: idMaps.employee_rates.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), created_by_user_id: targetUserId(row.created_by_user_id) || actor.id })), [
        "id", "tenant_id", "employee_id", "effective_date", "hourly_rate_cents", "note", "created_by_user_id", "created_at",
      ]);
      insertRows(service.db, "employee_time_entries", source.employee_time_entries.map((row) => ({ ...row, id: idMaps.employee_time_entries.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), created_by_user_id: targetUserId(row.created_by_user_id) || actor.id, corrected_by_user_id: targetUserId(row.corrected_by_user_id), voided_by_user_id: targetUserId(row.voided_by_user_id) })), [
        "id", "tenant_id", "employee_id", "clock_in_at", "clock_out_at", "clock_in_note", "clock_out_note", "duration_minutes", "rate_cents_snapshot", "status", "implausible", "created_by_user_id", "corrected_by_user_id", "corrected_at", "correction_reason", "voided_by_user_id", "voided_at", "void_reason", "before_json", "after_json", "created_at", "updated_at",
      ]);
      insertRows(service.db, "employee_pay_weeks", source.employee_pay_weeks.map((row) => ({ ...row, id: idMaps.employee_pay_weeks.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), closed_by_user_id: targetUserId(row.closed_by_user_id), reopened_by_user_id: targetUserId(row.reopened_by_user_id) })), [
        "id", "tenant_id", "employee_id", "week_start_date", "week_end_date", "payday_date", "status", "opening_carryover_cents", "valid_minutes", "gross_pay_cents", "positive_adjustments_cents", "negative_adjustments_cents", "advances_cents", "manual_payments_cents", "estimated_amount_due_cents", "closing_carryover_cents", "rate_breakdown_json", "snapshot_json", "closed_by_user_id", "closed_at", "reopened_by_user_id", "reopened_at", "reopen_reason", "created_at", "updated_at",
      ]);
      insertRows(service.db, "employee_pay_advances", source.employee_pay_advances.map((row) => ({ ...row, id: idMaps.employee_pay_advances.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), created_by_user_id: targetUserId(row.created_by_user_id) || actor.id, voided_by_user_id: targetUserId(row.voided_by_user_id) })), [
        "id", "tenant_id", "employee_id", "pay_week_start", "amount_cents", "advance_date", "note", "created_by_user_id", "voided_at", "voided_by_user_id", "void_reason", "created_at",
      ]);
      insertRows(service.db, "employee_pay_adjustments", source.employee_pay_adjustments.map((row) => ({ ...row, id: idMaps.employee_pay_adjustments.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), created_by_user_id: targetUserId(row.created_by_user_id) || actor.id, voided_by_user_id: targetUserId(row.voided_by_user_id) })), [
        "id", "tenant_id", "employee_id", "pay_week_start", "direction", "amount_cents", "reason", "created_by_user_id", "voided_at", "voided_by_user_id", "void_reason", "created_at",
      ]);
      insertRows(service.db, "employee_pay_manual_payments", source.employee_pay_manual_payments.map((row) => ({ ...row, id: idMaps.employee_pay_manual_payments.get(row.id), tenant_id: tenantId, employee_id: idMaps.employees.get(row.employee_id), recorded_by_user_id: targetUserId(row.recorded_by_user_id) || actor.id, voided_by_user_id: targetUserId(row.voided_by_user_id) })), [
        "id", "tenant_id", "employee_id", "pay_week_start", "amount_cents", "payment_date", "method", "reference", "note", "recorded_by_user_id", "voided_at", "voided_by_user_id", "void_reason", "created_at",
      ]);
      insertRows(service.db, "employee_announcements", source.employee_announcements.map((row) => ({ ...row, id: idMaps.employee_announcements.get(row.id), tenant_id: tenantId, portable_id: portableMaps.employee_announcements.get(row.portable_id), author_user_id: targetUserId(row.author_user_id) || actor.id, archived_by_user_id: targetUserId(row.archived_by_user_id) })), [
        "id", "portable_id", "tenant_id", "author_user_id", "title", "body", "publish_at", "expires_at", "audience_role", "archived_at", "archived_by_user_id", "created_at", "updated_at",
      ]);
      insertRows(service.db, "employee_announcement_reads", source.employee_announcement_reads.map((row) => ({ ...row, id: idMaps.employee_announcement_reads.get(row.id), tenant_id: tenantId, announcement_id: idMaps.employee_announcements.get(row.announcement_id), employee_id: idMaps.employees.get(row.employee_id), user_id: requiredTargetUserId(row.user_id) })), [
        "id", "tenant_id", "announcement_id", "employee_id", "user_id", "read_at",
      ]);
      insertRows(service.db, "employee_direct_messages", source.employee_direct_messages.map((row) => ({ ...row, id: idMaps.employee_direct_messages.get(row.id), tenant_id: tenantId, portable_id: portableMaps.employee_direct_messages.get(row.portable_id), sender_user_id: requiredTargetUserId(row.sender_user_id), recipient_user_id: requiredTargetUserId(row.recipient_user_id) })), [
        "id", "portable_id", "tenant_id", "sender_user_id", "recipient_user_id", "body", "sent_at", "recipient_read_at", "created_at",
      ]);
      for (const attachment of payload.attachments || []) {
        const metadata = attachment.metadata;
        const bytes = Buffer.from(attachment.content_base64, "base64");
        const extension = metadata.original_filename.includes(".") ? metadata.original_filename.slice(metadata.original_filename.lastIndexOf(".")).toLowerCase() : "";
        const storageKey = join(tenantId, idMaps.orders.get(metadata.order_id), `${randomUUID()}${extension}`).replace(/\\/g, "/");
        const path = service.attachmentPath(storageKey);
        stagedPaths.push(path);
        durableWriteFile(path, bytes, { flag: "wx", mode: 0o600 });
        service.db.prepare(
          `INSERT INTO order_attachments
           (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id,
            created_at, deleted_at, source_type, original_attachment_id, derivative_type, image_width, image_height, annotation_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          idMaps.attachments.get(metadata.id),
          portableMaps.attachments.get(metadata.portable_id),
          tenantId,
          idMaps.orders.get(metadata.order_id),
          metadata.original_filename,
          storageKey,
          metadata.mime_type,
          metadata.byte_size,
          metadata.sha256,
          actor.id,
          metadata.created_at,
          null,
          metadata.source_type || "upload",
          metadata.original_attachment_id ? idMaps.attachments.get(metadata.original_attachment_id) : null,
          metadata.derivative_type || null,
          metadata.image_width || null,
          metadata.image_height || null,
          metadata.annotation_json || null,
        );
      }
      service.db.prepare("DELETE FROM tenant_sequences WHERE tenant_id = ?").run(tenantId);
      const nextSequences = [
        ["customer", maxSequenceValue(source.customers, "customer_number", "C")],
        ["estimate", maxSequenceValue(source.estimates, "estimate_number", "E")],
        ["order", maxSequenceValue(source.orders, "order_number", "O")],
        ["work_order", maxSequenceValue(source.work_orders, "work_order_number", "WO")],
        ["invoice", maxSequenceValue(source.invoices, "invoice_number", "I")],
        ["employee", maxSequenceValue(source.employees, "employee_number", "EMP")],
      ];
      for (const [name, nextValue] of nextSequences) {
        service.db.prepare("INSERT INTO tenant_sequences (tenant_id, sequence_name, next_value) VALUES (?, ?, ?)").run(tenantId, name, nextValue);
      }
      const completed = now();
      const counts = payload.manifest.record_counts;
      const report = { backup_id: payload.manifest.backup_id, restored_counts: counts, user_mapping: preview.user_mapping, warnings: preview.warnings };
      service.db.prepare(
        `INSERT INTO backup_restore_receipts
         (id, backup_id, source_product, source_format_version, source_schema_version, source_tenant_identifier, target_tenant_id, actor_user_id, status, started_at, completed_at, restored_counts_json, warning_summary_json, error_summary_json, report_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), payload.manifest.backup_id, payload.manifest.source_product, payload.manifest.backup_format_version, payload.manifest.source_schema_version, payload.manifest.source_tenant_identifier, tenantId, actor.id, started, completed, JSON.stringify(counts), JSON.stringify(preview.warnings), JSON.stringify([]), JSON.stringify(report));
      service.audit(actor, "backup.restore_completed", "tenant", tenantId, target.portable_id, "Slim backup restored into empty tenant", { backup_id: payload.manifest.backup_id, restored_counts: counts });
      return report;
    });
    stagedPaths.length = 0;
    return result;
  } catch (err) {
    for (const path of stagedPaths) {
      if (!existsSync(path)) continue;
      rmSync(path, { force: true });
      trySyncDirectory(dirname(path));
    }
    const action = err.message === "backup_restore_blocked" ? "backup.restore_blocked" : "backup.restore_failed";
    const summary = action === "backup.restore_blocked" ? "Slim backup restore blocked" : "Slim backup restore failed or rolled back";
    service.audit(actor, action, "tenant", actor.tenant_id, target.portable_id, summary, { backup_id: payload?.manifest?.backup_id || "unknown", error: err.message });
    throw err;
  } finally {
    if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
  }
}

export function backupHistory(service, actor) {
  service.requireBackupRole(actor);
  return service.db
    .prepare("SELECT * FROM backup_restore_receipts WHERE target_tenant_id = ? ORDER BY started_at DESC")
    .all(actor.tenant_id)
    .map((row) => ({
      ...row,
      restored_counts: JSON.parse(row.restored_counts_json || "{}"),
      warnings: JSON.parse(row.warning_summary_json || "[]"),
      errors: JSON.parse(row.error_summary_json || "[]"),
      report: JSON.parse(row.report_json || "{}"),
    }));
}
