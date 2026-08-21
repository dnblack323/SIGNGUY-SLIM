import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const DATA_TABLES = [
  "tenants",
  "users",
  "customers",
  "estimates",
  "estimate_items",
  "orders",
  "order_items",
  "invoices",
  "calendar_events",
  "tenant_sequences",
  "audit_events",
];
const OPERATIONAL_TABLES = [
  "customers",
  "estimates",
  "estimate_items",
  "orders",
  "order_items",
  "invoices",
  "calendar_events",
  "order_attachments",
];

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

function canonicalJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
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
    invoices: selectAll(db, "invoices", actor.tenant_id, "invoice_number, id"),
    calendar_events: selectAll(db, "calendar_events", actor.tenant_id, "start_at, id"),
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

function buildManifest(snapshot, sourceCommit) {
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
    source_application_version: process.env.npm_package_version || "0.1.0-v1-part5",
    source_commit: sourceCommit || "unknown",
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
    const manifest = buildManifest(snapshot, body?.source_commit);
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
  const aad = {
    signature: container.signature,
    container_version: container.container_version,
    algorithm: container.algorithm,
    kdf: container.kdf,
    kdf_iterations: container.kdf_iterations,
  };
  if (container.signature !== BACKUP_SIGNATURE || container.container_version !== CONTAINER_VERSION) {
    throw backupError("backup_container_unrecognized", 400);
  }
  if (container.algorithm !== "AES-256-GCM" || container.kdf !== KDF || container.kdf_iterations !== KDF_ITERATIONS) {
    throw backupError("backup_format_unsupported", 400);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, Buffer.from(container.salt_b64, "base64")), Buffer.from(container.nonce_b64, "base64"));
    decipher.setAAD(jsonBuffer(aad));
    decipher.setAuthTag(Buffer.from(container.tag_b64, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(container.ciphertext_b64, "base64")), decipher.final()]);
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
  if (manifest.contains_secrets !== false) throw backupError("backup_contains_secrets", 400);
  for (const key of ["data", "attachments"]) {
    if (!payload[key]) throw backupError("backup_manifest_missing", 400);
  }
  const counts = Object.fromEntries(Object.entries(payload.data).map(([name, records]) => [name, records.length]));
  counts.attachments = payload.attachments.length;
  for (const [name, count] of Object.entries(manifest.record_counts || {})) {
    if (counts[name] !== count) throw backupError("backup_record_count_mismatch", 400);
  }
  const inventory = new Map((manifest.attachment_inventory || []).map((entry) => [entry.source_portable_id, entry]));
  for (const attachment of payload.attachments) {
    const bytes = Buffer.from(attachment.content_base64 || "", "base64");
    const entry = inventory.get(attachment.metadata?.portable_id);
    if (!entry) throw backupError("backup_attachment_missing", 400);
    if (entry.size_bytes !== bytes.length || entry.sha256 !== sha256Buffer(bytes)) {
      throw backupError("backup_checksum_mismatch", 400);
    }
  }
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
  const duplicate = service.db
    .prepare("SELECT id FROM backup_restore_receipts WHERE target_tenant_id = ? AND backup_id = ? AND status = 'completed'")
    .get(actor.tenant_id, payload.manifest.backup_id);
  if (duplicate) blocking_errors.push("duplicate_backup");
  const user_mapping = assignmentPreview(service, actor, payload);
  const unmatched = user_mapping.filter((entry) => !entry.matched);
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
  service.requireBackupRole(actor);
  try {
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
  service.requireBackupRole(actor);
  const payload = validatePayload(decryptBackup(readFileSync(file.temp_path), String(body?.passphrase || "")));
  const preview = restorePreviewFromPayload(service, actor, payload);
  const target = service.tenant(actor.tenant_id);
  if (!preview.restore_permitted) throw backupError("backup_restore_blocked", 409);
  if (String(body?.confirmation_phrase || "") !== target.company_name) throw backupError("backup_confirmation_required", 400);
  if (preview.required_unmatched_assignment_policy && body?.unmatched_assignment_policy !== "restore_unassigned") {
    throw backupError("backup_assignment_policy_required", 400);
  }
  const started = now();
  const stagedPaths = [];
  try {
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
        invoices: mapId(source.invoices),
        calendar_events: mapId(source.calendar_events),
        attachments: mapId((payload.attachments || []).map((entry) => entry.metadata)),
      };
      const portableMaps = {
        customers: new Map(source.customers.map((row) => [row.portable_id, localPortable(service.db, "customers", "customer", row.portable_id)])),
        estimates: new Map(source.estimates.map((row) => [row.portable_id, localPortable(service.db, "estimates", "estimate", row.portable_id)])),
        estimate_items: new Map(source.estimate_items.map((row) => [row.portable_id, localPortable(service.db, "estimate_items", "estimate_item", row.portable_id)])),
        orders: new Map(source.orders.map((row) => [row.portable_id, localPortable(service.db, "orders", "order", row.portable_id)])),
        order_items: new Map(source.order_items.map((row) => [row.portable_id, localPortable(service.db, "order_items", "order_item", row.portable_id)])),
        invoices: new Map(source.invoices.map((row) => [row.portable_id, localPortable(service.db, "invoices", "invoice", row.portable_id)])),
        calendar_events: new Map(source.calendar_events.map((row) => [row.portable_id, localPortable(service.db, "calendar_events", "calendar_event", row.portable_id)])),
        attachments: new Map((payload.attachments || []).map((entry) => [entry.metadata.portable_id, localPortable(service.db, "order_attachments", "order_attachment", entry.metadata.portable_id)])),
      };
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
      insertRows(service.db, "orders", source.orders.map((row) => ({ ...row, id: idMaps.orders.get(row.id), tenant_id: tenantId, portable_id: portableMaps.orders.get(row.portable_id), customer_id: idMaps.customers.get(row.customer_id), source_estimate_id: row.source_estimate_id ? idMaps.estimates.get(row.source_estimate_id) : null })), [
        "id", "portable_id", "tenant_id", "customer_id", "source_estimate_id", "order_number", "document_date", "due_date", "status", "customer_tax_exempt_snapshot", "tax_rate_basis_points_snapshot", "subtotal_cents", "discount_cents", "tax_cents", "total_cents", "internal_notes", "created_at", "updated_at",
      ]);
      for (const row of source.estimates.filter((entry) => entry.converted_order_id)) {
        service.db.prepare("UPDATE estimates SET converted_order_id = ? WHERE id = ? AND tenant_id = ?").run(idMaps.orders.get(row.converted_order_id), idMaps.estimates.get(row.id), tenantId);
      }
      insertRows(service.db, "order_items", source.order_items.map((row) => ({ ...row, id: idMaps.order_items.get(row.id), tenant_id: tenantId, portable_id: portableMaps.order_items.get(row.portable_id), order_id: idMaps.orders.get(row.order_id), source_estimate_item_id: row.source_estimate_item_id ? idMaps.estimate_items.get(row.source_estimate_item_id) : null, assigned_user_id: userMap.get(source.users.find((u) => u.id === row.assigned_user_id)?.portable_id) || null })), [
        "id", "portable_id", "tenant_id", "order_id", "source_estimate_item_id", "position", "description", "quantity_decimal", "unit_price_cents", "line_total_cents", "taxable", "production_required", "production_stage", "completed", "due_date", "assigned_user_id", "internal_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "invoices", source.invoices.map((row) => ({ ...row, id: idMaps.invoices.get(row.id), tenant_id: tenantId, portable_id: portableMaps.invoices.get(row.portable_id), order_id: idMaps.orders.get(row.order_id), customer_id: idMaps.customers.get(row.customer_id) })), [
        "id", "portable_id", "tenant_id", "order_id", "customer_id", "invoice_number", "document_date", "due_date", "document_status", "payment_status", "customer_tax_exempt_snapshot", "tax_rate_basis_points_snapshot", "subtotal_cents", "discount_cents", "tax_cents", "total_cents", "amount_paid_cents", "balance_due_cents", "historical_amount_paid_note", "created_at", "updated_at",
      ]);
      insertRows(service.db, "calendar_events", source.calendar_events.map((row) => ({ ...row, id: idMaps.calendar_events.get(row.id), tenant_id: tenantId, portable_id: portableMaps.calendar_events.get(row.portable_id), order_id: row.order_id ? idMaps.orders.get(row.order_id) : null, order_item_id: row.order_item_id ? idMaps.order_items.get(row.order_item_id) : null, assigned_user_id: userMap.get(source.users.find((u) => u.id === row.assigned_user_id)?.portable_id) || null, created_by_user_id: userMap.get(source.users.find((u) => u.id === row.created_by_user_id)?.portable_id) || actor.id })), [
        "id", "portable_id", "tenant_id", "title", "order_id", "order_item_id", "start_at", "end_at", "all_day", "assigned_user_id", "status", "internal_note", "created_by_user_id", "created_at", "updated_at",
      ]);
      for (const attachment of payload.attachments || []) {
        const metadata = attachment.metadata;
        const bytes = Buffer.from(attachment.content_base64, "base64");
        const extension = metadata.original_filename.includes(".") ? metadata.original_filename.slice(metadata.original_filename.lastIndexOf(".")).toLowerCase() : "";
        const storageKey = join(tenantId, idMaps.orders.get(metadata.order_id), `${randomUUID()}${extension}`).replace(/\\/g, "/");
        const path = service.attachmentPath(storageKey);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes, { flag: "wx" });
        stagedPaths.push(path);
        service.db.prepare(
          `INSERT INTO order_attachments
           (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(idMaps.attachments.get(metadata.id), portableMaps.attachments.get(metadata.portable_id), tenantId, idMaps.orders.get(metadata.order_id), metadata.original_filename, storageKey, metadata.mime_type, metadata.byte_size, metadata.sha256, actor.id, metadata.created_at, null);
      }
      service.db.prepare("DELETE FROM tenant_sequences WHERE tenant_id = ?").run(tenantId);
      const nextSequences = [
        ["customer", maxSequenceValue(source.customers, "customer_number", "C")],
        ["estimate", maxSequenceValue(source.estimates, "estimate_number", "E")],
        ["order", maxSequenceValue(source.orders, "order_number", "O")],
        ["invoice", maxSequenceValue(source.invoices, "invoice_number", "I")],
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
    for (const path of stagedPaths) if (existsSync(path)) rmSync(path, { force: true });
    service.audit(actor, "backup.restore_failed", "tenant", actor.tenant_id, target.portable_id, "Slim backup restore failed or rolled back", { backup_id: payload.manifest.backup_id, error: err.message });
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
