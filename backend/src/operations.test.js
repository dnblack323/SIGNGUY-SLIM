import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratedMemoryDatabase, openDatabase, runMigrations } from "./db.js";
import { createSlimServer } from "./server.js";
import {
  diagnosticsSnapshot,
  healthStatus,
  readinessStatus,
  redactForLog,
  requestIdFromHeaders,
  safeRequestPath,
  writeStructuredLog,
} from "./operations.js";

function listen(app) {
  return new Promise((resolve, reject) => {
    app.once("error", reject);
    app.listen(0, "127.0.0.1", () => {
      app.off("error", reject);
      resolve(app.address().port);
    });
  });
}

function close(app) {
  return new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  });
}

function tempProductionEnv() {
  const root = mkdtempSync(join(tmpdir(), "signguy-slim-ops-"));
  const dbDir = join(root, "db");
  const attachmentRoot = join(root, "attachments");
  const backupRoot = join(root, "server-backups");
  mkdirSync(dbDir);
  mkdirSync(attachmentRoot);
  mkdirSync(backupRoot);
  chmodSync(dbDir, 0o700);
  chmodSync(attachmentRoot, 0o700);
  chmodSync(backupRoot, 0o700);
  return {
    root,
    env: {
      NODE_ENV: "production",
      SIGNGUY_SLIM_DB_PATH: join(dbDir, "signguy-slim.sqlite"),
      SIGNGUY_SLIM_ATTACHMENT_ROOT: attachmentRoot,
      SIGNGUY_SLIM_SERVER_BACKUP_ROOT: backupRoot,
      SIGNGUY_SLIM_APP_URL: "https://slim.example.test",
      SIGNGUY_SLIM_RECOVERY_FROM_EMAIL: "recovery@slim.example.test",
      SIGNGUY_SLIM_COOKIE_SECURE: "1",
    },
  };
}

describe("Release D operations health and readiness", () => {
  it("returns cheap liveness without sensitive runtime data", () => {
    const response = healthStatus({ SIGNGUY_SLIM_COMMIT_SHA: "abc123" });

    expect(response).toMatchObject({ status: "ok", service: "signguy-slim", release: "abc123" });
    expect(JSON.stringify(response)).not.toMatch(/password|secret|cookie|token|authorization|csrf/i);
  });

  it("reports readiness for a migrated database", () => {
    const db = migratedMemoryDatabase();

    try {
      const status = readinessStatus(db);

      expect(status.status).toBe("ready");
      expect(status.checks.every((check) => check.status === "ok")).toBe(true);
      expect(JSON.stringify(status)).not.toMatch(/password|secret|cookie|authorization|csrf/i);
    } finally {
      db.close();
    }
  });

  it("reports readiness failure when migrations are unknown", () => {
    const db = migratedMemoryDatabase();

    try {
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("999_unknown.sql", new Date().toISOString());
      const status = readinessStatus(db);

      expect(status.status).toBe("not_ready");
      expect(status.checks.find((check) => check.name === "migrations_current")).toMatchObject({
        status: "failed",
        detail: "migration_status_unavailable",
      });
    } finally {
      db.close();
    }
  });

  it("reports production restore-marker readiness failure safely", () => {
    const { env } = tempProductionEnv();
    const db = openDatabase(env.SIGNGUY_SLIM_DB_PATH, { production: true });
    try {
      runMigrations(db);
      writeFileSync(join(env.SIGNGUY_SLIM_DB_PATH, "..", ".signguy-slim-restore-in-progress.json"), JSON.stringify({
        operation: "restore_server_backup",
        restore_id: "restore-test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const status = readinessStatus(db, { env });

      expect(status.status).toBe("not_ready");
      expect(status.checks.find((check) => check.name === "restore_marker_absent")).toMatchObject({
        status: "failed",
        detail: "server_restore_incomplete",
      });
      expect(JSON.stringify(status)).not.toContain(env.SIGNGUY_SLIM_DB_PATH);
    } finally {
      db.close();
    }
  });

  it("keeps production readiness public details stable and non-mutating", () => {
    const { env, root } = tempProductionEnv();
    rmSync(env.SIGNGUY_SLIM_SERVER_BACKUP_ROOT, { recursive: true, force: true });
    const db = migratedMemoryDatabase();

    try {
      const status = readinessStatus(db, { env });

      expect(status.status).toBe("not_ready");
      expect(status.checks.find((check) => check.name === "production_config")).toMatchObject({
        status: "failed",
        detail: "production_server_backup_root_missing",
      });
      expect(JSON.stringify(status)).not.toContain(root);
      expect(() => rmSync(root, { recursive: true, force: false })).not.toThrow();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Release D request correlation and structured logs", () => {
  it("accepts only bounded safe caller request IDs", () => {
    expect(requestIdFromHeaders({ "x-request-id": "edge-req_123:abc.def" })).toBe("edge-req_123:abc.def");
    expect(requestIdFromHeaders({ "x-request-id": "x".repeat(128) })).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFromHeaders({ "x-request-id": "bad\nid" })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("bounds attacker-selected paths before logging", () => {
    expect(safeRequestPath(`/api/${"a".repeat(300)}?token=secret`)).toMatch(/^\/__long_path__\/[a-f0-9]{12}$/);
    expect(safeRequestPath("/api/customers?token=secret")).toBe("/api/customers");
  });

  it("redacts credential-shaped fields recursively", () => {
    expect(redactForLog({
      ok: true,
      password: "pw",
      nested: { csrf_token: "csrf", sendgrid_api_key: "sg", value: "kept" },
    })).toEqual({
      ok: true,
      password: "[redacted]",
      nested: { csrf_token: "[redacted]", sendgrid_api_key: "[redacted]", value: "kept" },
    });
  });

  it("writes JSON lines without leaking credential-shaped fields", () => {
    const lines = [];
    writeStructuredLog("error", "test_event", {
      request_id: "req-1",
      password: "pw",
      cookie_header: "session=secret",
      nested: { authorization: "Bearer secret", code: "safe_code" },
    }, { error: (line) => lines.push(line) });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      event: "test_event",
      request_id: "req-1",
      password: "[redacted]",
      cookie_header: "[redacted]",
      nested: { authorization: "[redacted]", code: "safe_code" },
    });
  });

  it("returns request IDs and logs error correlation for HTTP failures", async () => {
    const logs = [];
    const logger = {
      log: (line) => logs.push(JSON.parse(line)),
      error: (line) => logs.push(JSON.parse(line)),
    };
    const db = migratedMemoryDatabase();
    const server = createSlimServer(db, { logger });

    try {
      const port = await listen(server);
      const response = await fetch(`http://127.0.0.1:${port}/api/customers`, {
        headers: { "X-Request-Id": "release-d-test" },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-request-id")).toBe("release-d-test");
      expect(body).toMatchObject({ error: "unauthorized", request_id: "release-d-test" });
      expect(logs.some((entry) => entry.event === "http_error" && entry.request_id === "release-d-test")).toBe(true);
      expect(logs.some((entry) => entry.event === "http_request" && entry.request_id === "release-d-test")).toBe(true);
      expect(JSON.stringify(logs)).not.toMatch(/cookie|authorization|csrf_token|password/i);
    } finally {
      await close(server);
      db.close();
    }
  });
});

describe("Release D operator diagnostics", () => {
  it("summarizes safe diagnostics and failed email delivery state", () => {
    const db = migratedMemoryDatabase();

    try {
      const tenantId = "tenant-ops";
      db.prepare("INSERT INTO tenants (id, portable_id, slug, company_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(tenantId, "tenant_portable", "ops-shop", "Ops Shop", new Date().toISOString(), new Date().toISOString());
      db.prepare("INSERT INTO users (id, portable_id, tenant_id, email, password_hash, display_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .run("user-ops", "user_portable", tenantId, "owner@example.test", "hash", "Owner", "owner", new Date().toISOString(), new Date().toISOString());
      db.prepare(
        `INSERT INTO customers
         (id, portable_id, tenant_id, customer_number, contact_name, billing_line1, billing_city, billing_state, billing_postal_code, billing_country, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("customer-ops", "customer_portable", tenantId, "C-00001", "Customer", "1 Main", "Town", "PA", "17000", "US", new Date().toISOString(), new Date().toISOString());
      db.prepare(
        `INSERT INTO orders
         (id, portable_id, tenant_id, customer_id, order_number, document_date, status, customer_tax_exempt_snapshot,
          tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, 0, 0, 0, ?, ?)`,
      ).run("order-ops", "order_portable", tenantId, "customer-ops", "O-00001", "2026-09-01", new Date().toISOString(), new Date().toISOString());
      db.prepare(
        `INSERT INTO outbound_email_sends
         (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
          sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, delivery_state, failure_reason,
          document_attached, order_attachment_ids_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(
        "email-ops",
        "email_portable",
        tenantId,
        "key-ops",
        "customer-ops",
        "order",
        "order-ops",
        "order",
        "user-ops",
        "sender@example.test",
        "Ops",
        "customer@example.test",
        "[]",
        "Subject",
        "Body",
        "failed",
        "email_provider_rejected",
        "[]",
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );

      const snapshot = diagnosticsSnapshot(db, { tenantId });

      expect(snapshot.email.failed_or_rejected).toBe(1);
      expect(snapshot.users.active).toBe(1);
      expect(snapshot.database.pending_migrations).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toMatch(/owner@example|customer@example|Subject|Body|password|secret|cookie|token|authorization|csrf/i);
      expect(snapshot.database.path_fingerprint).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("reports migration inspection failure instead of a healthy empty pending list", () => {
    const db = migratedMemoryDatabase();

    try {
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("999_unknown.sql", new Date().toISOString());
      const snapshot = diagnosticsSnapshot(db);

      expect(snapshot.database.migration_status).toBe("failed");
      expect(snapshot.database.pending_migrations).toBeNull();
      expect(snapshot.database.error).toBe("database_schema_has_unknown_migrations");
    } finally {
      db.close();
    }
  });

  it("reports diagnostic count failures instead of converting them to zero", () => {
    const fakeDb = {
      prepare(sql) {
        if (sql.includes("SELECT 1 AS ok")) return { get: () => ({ ok: 1 }) };
        if (sql.includes("sqlite_master")) return { get: () => null };
        if (sql.includes("outbound_email_sends")) {
          return sql.includes("GROUP BY")
            ? { all: () => [] }
            : { get: () => ({ count: 0 }) };
        }
        throw new Error("SQLITE_ERROR");
      },
    };

    const snapshot = diagnosticsSnapshot(fakeDb, { env: { SIGNGUY_SLIM_DB_PATH: ":memory:" } });

    expect(snapshot.tenants).toMatchObject({ status: "unavailable", total: null, error: "diagnostic_query_unavailable" });
    expect(snapshot.users).toMatchObject({ status: "unavailable", total: null, active: null, error: "diagnostic_query_unavailable" });
    expect(snapshot.storage).toMatchObject({
      status: "unavailable",
      order_attachment_bytes: null,
      intake_attachment_bytes: null,
      total_tracked_attachment_bytes: null,
      error: "diagnostic_query_unavailable",
    });
  });

  it("matches intake storage diagnostics to authoritative quota accounting", () => {
    const db = migratedMemoryDatabase();

    try {
      const tenantId = "tenant-storage";
      const now = new Date().toISOString();
      db.prepare("INSERT INTO tenants (id, portable_id, slug, company_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(tenantId, "tenant_storage_portable", "storage-shop", "Storage Shop", now, now);
      db.prepare(
        `INSERT INTO intake_source_messages
         (id, portable_id, tenant_id, provider_message_id, intake_address, sender_email, recipients_json, subject,
          received_at, payload_hash, receipt_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("source-storage", "source_storage_portable", tenantId, "msg-storage", "orders@example.test", "customer@example.test", "[]", "Request", now, "hash", "received", now);
      db.prepare(
        `INSERT INTO intake_attachments
         (id, tenant_id, source_message_id, original_filename, storage_key, mime_type, byte_size, sha256, accepted, rejection_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("accepted-storage", tenantId, "source-storage", "accepted.txt", "intake/accepted.txt", "text/plain", 11, "abc", 1, null, now);
      db.prepare(
        `INSERT INTO intake_attachments
         (id, tenant_id, source_message_id, original_filename, storage_key, mime_type, byte_size, sha256, accepted, rejection_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("rejected-storage", tenantId, "source-storage", "rejected.txt", null, "text/plain", 99, null, 0, "storage_quota_exceeded", now);

      const snapshot = diagnosticsSnapshot(db, { tenantId });

      expect(snapshot.storage.intake_attachment_bytes).toBe(11);
      expect(snapshot.storage.total_tracked_attachment_bytes).toBe(11);
    } finally {
      db.close();
    }
  });

  it("normalizes email timestamps before stale-delivery cutoff comparisons", () => {
    const db = migratedMemoryDatabase();

    try {
      const tenantId = "tenant-stale-email";
      const oldIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO tenants (id, portable_id, slug, company_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(tenantId, "tenant_stale_portable", "stale-shop", "Stale Shop", now, now);
      db.prepare("INSERT INTO users (id, portable_id, tenant_id, email, password_hash, display_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .run("user-stale", "user_stale_portable", tenantId, "owner@example.test", "hash", "Owner", "owner", now, now);
      db.prepare(
        `INSERT INTO customers
         (id, portable_id, tenant_id, customer_number, contact_name, billing_line1, billing_city, billing_state, billing_postal_code, billing_country, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("customer-stale", "customer_stale_portable", tenantId, "C-00001", "Customer", "1 Main", "Town", "PA", "17000", "US", now, now);
      db.prepare(
        `INSERT INTO orders
         (id, portable_id, tenant_id, customer_id, order_number, document_date, status, customer_tax_exempt_snapshot,
          tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, 0, 0, 0, ?, ?)`,
      ).run("order-stale", "order_stale_portable", tenantId, "customer-stale", "O-00001", "2026-09-01", now, now);
      db.prepare(
        `INSERT INTO outbound_email_sends
         (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
          sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, delivery_state, failure_reason,
          document_attached, order_attachment_ids_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run("email-stale", "email_stale_portable", tenantId, "key-stale", "customer-stale", "order", "order-stale", "order", "user-stale", "sender@example.test", "Ops", "customer@example.test", "[]", "Subject", "Body", "queued", null, "[]", oldIso, oldIso);

      const snapshot = diagnosticsSnapshot(db, { tenantId });

      expect(snapshot.email.stale_pending_or_deferred_over_24h).toBe(1);
    } finally {
      db.close();
    }
  });

  it("excludes unpublished partial or invalid backup directories from diagnostics", () => {
    const { env, root } = tempProductionEnv();
    const db = migratedMemoryDatabase();

    try {
      const partial = join(env.SIGNGUY_SLIM_SERVER_BACKUP_ROOT, "unfinished.partial");
      const invalid = join(env.SIGNGUY_SLIM_SERVER_BACKUP_ROOT, "invalid-backup");
      mkdirSync(partial);
      mkdirSync(invalid);
      writeFileSync(join(partial, "backup-metadata.json"), JSON.stringify({ backup_set_id: "unfinished", backup_type: "full", created_at: new Date().toISOString() }));
      writeFileSync(join(invalid, "backup-metadata.json"), JSON.stringify({ backup_set_id: "invalid", backup_type: "full", created_at: new Date().toISOString() }));

      const snapshot = diagnosticsSnapshot(db, { env });

      expect(snapshot.server_backups.available_sets).toBe(0);
      expect(snapshot.server_backups.latest).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain(root);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails production diagnostics before opening or creating a missing database", () => {
    const { env, root } = tempProductionEnv();

    try {
      const result = spawnSync(process.execPath, ["backend/src/operations.js"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ...env },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("production_database_file_missing");
      expect(result.stderr).not.toContain(root);
      expect(existsSync(env.SIGNGUY_SLIM_DB_PATH)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
