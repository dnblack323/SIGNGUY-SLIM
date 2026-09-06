import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { pendingMigrationIds } from "./db.js";
import { attachmentRoot, databasePath, isProductionRuntime, serverBackupRoot, validateProductionConfig } from "./config.js";
import { assertNoIncompleteServerRestore, validCompletedBackupSet } from "./serverBackup.js";

const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_LOGGED_PATH_LENGTH = 160;
const REDACTED = "[redacted]";
const SECRET_KEY_RE = /(password|passphrase|token|csrf|cookie|authorization|secret|api[_-]?key|signature)/i;

export function safeRequestId(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const id = typeof first === "string" ? first.trim() : "";
  return SAFE_REQUEST_ID_RE.test(id) ? id : null;
}

export function requestIdFromHeaders(headers = {}) {
  return safeRequestId(headers["x-request-id"]) || randomUUID();
}

export function safeRequestPath(url = "") {
  try {
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname.length <= MAX_LOGGED_PATH_LENGTH) return pathname;
    return `/__long_path__/${createHash("sha256").update(pathname).digest("hex").slice(0, 12)}`;
  } catch {
    return "/";
  }
}

export function redactForLog(value) {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SECRET_KEY_RE.test(key) ? REDACTED : redactForLog(entry),
  ]));
}

export function writeStructuredLog(level, event, fields = {}, logger = console) {
  const payload = redactForLog({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  const line = `${JSON.stringify(payload)}\n`;
  if (level === "error" || level === "warn") {
    (logger.error || logger.log).call(logger, line.trimEnd());
  } else {
    (logger.log || logger.info).call(logger, line.trimEnd());
  }
  return payload;
}

export function healthStatus(env = process.env) {
  return {
    status: "ok",
    service: "signguy-slim",
    version: packageVersion(),
    release: env.SIGNGUY_SLIM_COMMIT_SHA || env.GITHUB_SHA || "local",
  };
}

export function readinessStatus(db, { env = process.env } = {}) {
  const checks = [];
  const add = (name, ok, detail = null) => checks.push({
    name,
    status: ok ? "ok" : "failed",
    ...(detail ? { detail } : {}),
  });

  try {
    db.prepare("SELECT 1 AS ok").get();
    add("database_reachable", true);
  } catch {
    add("database_reachable", false, "database_unavailable");
  }

  try {
    const pending = pendingMigrationIds(db);
    add("migrations_current", pending.length === 0, pending.length ? "migrations_pending" : null);
  } catch {
    add("migrations_current", false, "migration_status_unavailable");
  }

  if (isProductionRuntime(env)) {
    let config = null;
    try {
      config = nonMutatingProductionConfig(env);
      add("production_config", true);
      add("production_database_file", existsSync(config.dbPath), existsSync(config.dbPath) ? null : "production_database_file_missing");
    } catch (error) {
      add("production_config", false, stableErrorCode(error, "production_config_invalid"));
      add("production_database_file", false, "production_config_invalid");
    }

    try {
      assertNoIncompleteServerRestore(config?.dbPath || databasePath(env));
      add("restore_marker_absent", true);
    } catch {
      add("restore_marker_absent", false, "server_restore_incomplete");
    }
  } else {
    add("production_config", true, "not_production");
    add("restore_marker_absent", true, "not_production");
  }

  const ready = checks.every((check) => check.status === "ok");
  return {
    status: ready ? "ready" : "not_ready",
    service: "signguy-slim",
    version: packageVersion(),
    release: env.SIGNGUY_SLIM_COMMIT_SHA || env.GITHUB_SHA || "local",
    checks,
  };
}

export function diagnosticsSnapshot(db, { env = process.env, tenantId = null } = {}) {
  const config = safeProductionConfig(env);
  const migration = migrationStatus(db);
  return {
    service: "signguy-slim",
    version: packageVersion(),
    release: env.SIGNGUY_SLIM_COMMIT_SHA || env.GITHUB_SHA || "local",
    environment: {
      production: isProductionRuntime(env),
      node_env: env.NODE_ENV || "development",
    },
    database: {
      configured: databasePath(env) !== ":memory:",
      path_fingerprint: fingerprintPath(databasePath(env)),
      reachable: safeBoolean(() => Boolean(db.prepare("SELECT 1 AS ok").get())),
      migration_status: migration.status,
      pending_migrations: migration.pending_migrations,
      ...(migration.error ? { error: migration.error } : {}),
    },
    production_config: config,
    restore: restoreMarkerStatus(env),
    server_backups: latestBackupSummary(env),
    storage: storageSummary(db, env, tenantId),
    email: emailDeliverySummary(db, tenantId),
    tenants: countSummary(db, "tenants", tenantId ? "id = ?" : null, tenantId ? [tenantId] : []),
    users: userSummary(db, tenantId),
  };
}

function packageVersion() {
  const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  return JSON.parse(raw).version;
}

function safeValue(work, fallback) {
  try {
    return work();
  } catch {
    return fallback;
  }
}

function safeBoolean(work) {
  try {
    return Boolean(work());
  } catch {
    return false;
  }
}

function stableErrorCode(error, fallback) {
  const message = String(error?.message || "");
  if (/^[a-z0-9_]+$/i.test(message)) return message;
  if (/^[A-Z0-9_]+$/.test(String(error?.code || ""))) return String(error.code).toLowerCase();
  return fallback;
}

function fingerprintPath(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

function assertPlainDirectory(path, code) {
  try {
    const stats = lstatSync(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(code);
  } catch (error) {
    if (error.message === code) throw error;
    throw new Error(code, { cause: error });
  }
}

function assertRegularFile(path, code) {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(code);
  } catch (error) {
    if (error.message === code) throw error;
    throw new Error(code, { cause: error });
  }
}

function assertDirectoryWritableAccess(path, code) {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
  } catch (error) {
    throw new Error(code, { cause: error });
  }
}

function assertFileWritableAccess(path, code) {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
  } catch (error) {
    throw new Error(code, { cause: error });
  }
}

function nonMutatingProductionConfig(env) {
  const config = validateProductionConfig({
    env,
    production: true,
    checkWritable: false,
  });
  assertPlainDirectory(dirname(config.dbPath), "production_db_directory_missing");
  assertPlainDirectory(config.attachmentRoot, "production_attachment_root_missing");
  assertPlainDirectory(config.serverBackupRoot, "production_server_backup_root_missing");
  assertDirectoryWritableAccess(dirname(config.dbPath), "production_db_directory_unavailable");
  assertDirectoryWritableAccess(config.attachmentRoot, "production_attachment_root_unavailable");
  assertDirectoryWritableAccess(config.serverBackupRoot, "production_server_backup_root_unavailable");
  if (existsSync(config.dbPath)) assertFileWritableAccess(config.dbPath, "production_database_file_unavailable");
  return config;
}

function productionDiagnosticsDatabasePath(env) {
  if (!isProductionRuntime(env)) return databasePath(env);
  const config = nonMutatingProductionConfig(env);
  assertRegularFile(config.dbPath, "production_database_file_missing");
  return config.dbPath;
}

function migrationStatus(db) {
  try {
    return { status: "ok", pending_migrations: pendingMigrationIds(db) };
  } catch (error) {
    return {
      status: "failed",
      pending_migrations: null,
      error: stableErrorCode(error, "migration_status_unavailable"),
    };
  }
}

function safeProductionConfig(env) {
  try {
    const config = isProductionRuntime(env)
      ? nonMutatingProductionConfig(env)
      : validateProductionConfig({ env, production: false, checkWritable: false });
    return {
      status: "ok",
      production: config.production,
      app_public_url_configured: Boolean(config.appPublicUrl),
      recovery_from_email_configured: Boolean(config.recoveryFromEmail),
      public_registration_enabled: Boolean(config.publicRegistrationEnabled),
      trusted_proxy_enabled: Boolean(config.trustedProxyEnabled),
      server_backup_retain_last: config.serverBackupRetainLast,
      default_tenant_storage_quota_bytes: config.defaultTenantStorageQuotaBytes,
      db_path_fingerprint: fingerprintPath(config.dbPath),
      attachment_root_fingerprint: fingerprintPath(config.attachmentRoot),
      server_backup_root_fingerprint: fingerprintPath(config.serverBackupRoot),
    };
  } catch (error) {
    return { status: "failed", error: stableErrorCode(error, "production_config_invalid") };
  }
}

function restoreMarkerStatus(env) {
  try {
    assertNoIncompleteServerRestore(databasePath(env));
    return { incomplete_restore_marker_present: false };
  } catch (error) {
    return { incomplete_restore_marker_present: true, error: error.message || "server_restore_incomplete" };
  }
}

function latestBackupSummary(env) {
  const root = serverBackupRoot(env);
  try {
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".partial"))
      .map((entry) => {
        const setPath = join(root, entry.name);
        const metadata = validCompletedBackupSet(setPath);
        if (!metadata) return null;
        return {
          backup_set_id: metadata.backup_set_id || entry.name,
          type: metadata.backup_type || "unknown",
          created_at: metadata.created_at || null,
          status: metadata.status || "available",
        };
      })
      .filter(Boolean)
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    return {
      configured: true,
      path_fingerprint: fingerprintPath(root),
      latest: entries[0] || null,
      available_sets: entries.length,
    };
  } catch (error) {
    return {
      configured: Boolean(root),
      path_fingerprint: fingerprintPath(root),
      status: "unavailable",
      error: error?.code === "ENOENT" ? "server_backup_root_missing" : "server_backup_status_unavailable",
    };
  }
}

function storageSummary(db, env, tenantId) {
  const attachmentBytes = countAttachmentBytes(db, "order_attachments", tenantId);
  const intakeBytes = countAttachmentBytes(db, "intake_attachments", tenantId);
  let rootStatus = { configured: Boolean(attachmentRoot(env)), path_fingerprint: fingerprintPath(attachmentRoot(env)) };
  try {
    const stats = statSync(attachmentRoot(env));
    rootStatus = { ...rootStatus, available: stats.isDirectory() };
  } catch {
    rootStatus = { ...rootStatus, available: false };
  }
  return {
    status: attachmentBytes.error || intakeBytes.error ? "unavailable" : "ok",
    attachment_root: rootStatus,
    order_attachment_bytes: attachmentBytes.value,
    intake_attachment_bytes: intakeBytes.value,
    total_tracked_attachment_bytes: attachmentBytes.error || intakeBytes.error ? null : attachmentBytes.value + intakeBytes.value,
    ...(attachmentBytes.error || intakeBytes.error ? { error: "diagnostic_query_unavailable" } : {}),
  };
}

function countAttachmentBytes(db, table, tenantId) {
  try {
    const clauses = [];
    const params = [];
    if (tenantId) {
      clauses.push("tenant_id = ?");
      params.push(tenantId);
    }
    if (table === "intake_attachments") {
      clauses.push("accepted = 1");
      clauses.push("storage_key IS NOT NULL");
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = db.prepare(`SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM ${table} ${where}`).get(...params);
    return { value: Number(row?.bytes || 0), error: null };
  } catch {
    return { value: null, error: "diagnostic_query_unavailable" };
  }
}

function emailDeliverySummary(db, tenantId) {
  const params = tenantId ? [tenantId] : [];
  const where = tenantId ? "WHERE tenant_id = ?" : "";
  const rows = safeValue(() => db.prepare(
    `SELECT delivery_state, COUNT(*) AS count
     FROM outbound_email_sends
     ${where}
     GROUP BY delivery_state`,
  ).all(...params), []);
  const stalePending = safeValue(() => db.prepare(
    `SELECT COUNT(*) AS count
     FROM outbound_email_sends
     WHERE delivery_state IN ('queued', 'sent', 'deferred')
       AND datetime(created_at) < datetime('now', '-1 day')
       ${tenantId ? "AND tenant_id = ?" : ""}`,
  ).get(...params)?.count || 0, 0);
  const failedStates = new Set(["failed", "bounced", "dropped", "blocked", "spam_report"]);
  const byState = Object.fromEntries(rows.map((row) => [row.delivery_state, Number(row.count || 0)]));
  return {
    by_state: byState,
    failed_or_rejected: rows.reduce((sum, row) => sum + (failedStates.has(row.delivery_state) ? Number(row.count || 0) : 0), 0),
    stale_pending_or_deferred_over_24h: Number(stalePending || 0),
  };
}

function countSummary(db, table, where, params) {
  const count = countRows(db, table, where, params);
  if (count.error) return { status: "unavailable", total: null, error: count.error };
  return { status: "ok", total: count.value };
}

function userSummary(db, tenantId) {
  const total = countRows(db, "users", tenantId ? "tenant_id = ?" : null, tenantId ? [tenantId] : []);
  const active = countRows(db, "users", tenantId ? "tenant_id = ? AND active = 1" : "active = 1", tenantId ? [tenantId] : []);
  if (total.error || active.error) {
    return {
      status: "unavailable",
      total: total.value,
      active: active.value,
      error: total.error || active.error,
    };
  }
  return { status: "ok", total: total.value, active: active.value };
}

function countRows(db, table, where = null, params = []) {
  try {
    const clause = where ? `WHERE ${where}` : "";
    return { value: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${clause}`).get(...params)?.count || 0), error: null };
  } catch {
    return { value: null, error: "diagnostic_query_unavailable" };
  }
}

async function runDiagnosticsCli() {
  const { openDatabase } = await import("./db.js");
  const args = process.argv.slice(2);
  const tenantIndex = args.indexOf("--tenant");
  const tenantId = tenantIndex >= 0 ? args[tenantIndex + 1] : null;
  const db = openDatabase(productionDiagnosticsDatabasePath(process.env), { production: isProductionRuntime(process.env) });
  try {
    process.stdout.write(`${JSON.stringify(diagnosticsSnapshot(db, { tenantId }), null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDiagnosticsCli().catch((error) => {
    process.stderr.write(`${stableErrorCode(error, "diagnostics_failed")}\n`);
    process.exitCode = 1;
  });
}
