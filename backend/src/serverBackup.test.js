import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateProductionConfig } from "./config.js";
import { openDatabase, runMigrations } from "./db.js";
import { SlimService } from "./services.js";
import { decryptBackup } from "./backup.js";
import {
  applyBackupRetention,
  createAttachmentBackup,
  createServerBackup,
  migrateProductionDatabase,
  restoreAttachmentsBackup,
  restoreDatabaseBackup,
  restoreServerBackup,
  sha256File,
  verifyAttachmentBackup,
} from "./serverBackup.js";

const ORIGINAL_ENV = { ...process.env };
const tempDirs = [];

const address = {
  line1: "10 Main St",
  line2: null,
  city: "Austin",
  state: "TX",
  postal_code: "78701",
  country: "US",
};

function tempDir(prefix = "signguy-slim-release-a-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  resetEnv();
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function item(overrides = {}) {
  return {
    title: "Banner",
    description: "Banner",
    quantity_decimal: "1",
    unit_price_cents: 1200,
    taxable: true,
    production_required: true,
    ...overrides,
  };
}

function metadata(type, id = "test-backup") {
  return {
    backup_format: "signguy-slim-server-backup",
    backup_format_version: "1.0.0",
    backup_type: type,
    backup_set_id: id,
    created_at: new Date().toISOString(),
  };
}

async function seededRuntime() {
  const root = tempDir();
  const dbPath = join(root, "runtime", "signguy.sqlite");
  const attachmentsRoot = join(root, "attachments");
  process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT = attachmentsRoot;
  const db = openDatabase(dbPath);
  runMigrations(db);
  const service = new SlimService(db);
  const session = await service.registerTenant({
    tenant_name: "Release A Shop",
    tenant_slug: "release-a",
    owner_name: "Owner",
    owner_email: "owner-release-a@example.com",
    owner_password: "password123",
    sales_tax_rate_basis_points: 825,
  });
  const actor = session.user;
  const customer = service.createCustomer(actor, {
    contact_name: "Jane Customer",
    business_name: "Jane Co",
    email: "jane@example.com",
    phone: "555-0100",
    billing_address: address,
  });
  const order = service.createOrder(actor, { title: "Backup Order", customer_id: customer.id, items: [item()] });
  const attachment = service.uploadOrderAttachment(actor, order.id, {
    filename: "proof.txt",
    mime_type: "text/plain",
    buffer: Buffer.from("release-a-proof"),
  });
  return { root, db, service, actor, dbPath, attachmentsRoot, customer, order, attachment };
}

describe("Release A production storage config", () => {
  it("fails production startup for missing or relative durability paths", () => {
    expect(() => validateProductionConfig({ env: { NODE_ENV: "production" }, production: true, checkWritable: false })).toThrow("production_db_path_required");
    expect(() => validateProductionConfig({
      env: {
        NODE_ENV: "production",
        SIGNGUY_SLIM_DB_PATH: "./data/signguy.sqlite",
        SIGNGUY_SLIM_ATTACHMENT_ROOT: "./data/attachments",
        SIGNGUY_SLIM_SERVER_BACKUP_ROOT: "./data/server-backups",
      },
      production: true,
      checkWritable: false,
    })).toThrow("production_db_path_must_be_absolute");
  });

  it("accepts explicit writable durable production paths outside the repository", () => {
    const root = tempDir();
    const config = validateProductionConfig({
      env: {
        NODE_ENV: "production",
        SIGNGUY_SLIM_DB_PATH: join(root, "db", "signguy.sqlite"),
        SIGNGUY_SLIM_ATTACHMENT_ROOT: join(root, "attachments"),
        SIGNGUY_SLIM_SERVER_BACKUP_ROOT: join(root, "server-backups"),
        SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST: "7",
      },
      production: true,
    });
    expect(config.serverBackupRetainLast).toBe(7);
    expect(existsSync(dirname(config.dbPath))).toBe(true);
    expect(existsSync(config.attachmentRoot)).toBe(true);
    expect(existsSync(config.serverBackupRoot)).toBe(true);
  });

  it("rejects production attachment and backup roots that can recursively include each other", () => {
    const root = tempDir();
    expect(() => validateProductionConfig({
      env: {
        NODE_ENV: "production",
        SIGNGUY_SLIM_DB_PATH: join(root, "db", "signguy.sqlite"),
        SIGNGUY_SLIM_ATTACHMENT_ROOT: join(root, "files"),
        SIGNGUY_SLIM_SERVER_BACKUP_ROOT: join(root, "files", "server-backups"),
      },
      production: true,
      checkWritable: false,
    })).toThrow("production_attachment_and_backup_roots_must_be_separate");
  });
});

describe("Release A SQLite runtime hardening", () => {
  it("opens file-backed SQLite with foreign keys, busy timeout, and WAL", () => {
    const dbPath = join(tempDir(), "runtime", "signguy.sqlite");
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
      expect(db.prepare("PRAGMA busy_timeout").get().timeout).toBe(5000);
      expect(db.prepare("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    } finally {
      db.close();
    }
  });
});

describe("Release A server backup and restore", () => {
  it("creates a verified full backup set and restores database and attachments with emergency copies", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "server-backups");
    const backup = createServerBackup({
      dbPath: runtime.dbPath,
      sourceRoot: runtime.attachmentsRoot,
      backupRoot,
      retainLast: 5,
    });

    const metadata = JSON.parse(readFileSync(join(backup.path, "backup-metadata.json"), "utf8"));
    const attachmentManifest = JSON.parse(readFileSync(join(backup.path, "attachments-manifest.json"), "utf8"));
    expect(metadata.backup_type).toBe("full");
    expect(metadata.database.quick_check).toBe("ok");
    expect(metadata.database.schema_migrations).toContain("014_hardening_production_source_of_truth.sql");
    expect(metadata.attachments.file_count).toBe(1);
    expect(attachmentManifest.files[0].relative_path).toContain(runtime.order.id);
    expect(attachmentManifest.files[0].sha256).toBe(runtime.attachment.sha256);

    const restoreDbPath = join(runtime.root, "restore", "signguy.sqlite");
    const restoreAttachmentsRoot = join(runtime.root, "restore-attachments");
    mkdirSync(dirname(restoreDbPath), { recursive: true });
    writeFileSync(restoreDbPath, "old-db", { flag: "wx" });
    writeFileSync(`${restoreDbPath}-wal`, "stale-wal", { flag: "wx" });
    writeFileSync(`${restoreDbPath}-shm`, "stale-shm", { flag: "wx" });
    writeFileSync(join(runtime.root, "old-attachment-root-marker.txt"), "marker", { flag: "wx" });
    rmSync(restoreAttachmentsRoot, { recursive: true, force: true });

    const dbRestore = restoreDatabaseBackup({
      inputPath: backup.path,
      targetDbPath: restoreDbPath,
      backupRoot,
      confirmation: "RESTORE_DATABASE",
    });
    const attachmentRestore = restoreAttachmentsBackup({
      inputPath: backup.path,
      targetRoot: restoreAttachmentsRoot,
      backupRoot,
      confirmation: "RESTORE_ATTACHMENTS",
    });

    expect(existsSync(dbRestore.emergency_backup)).toBe(true);
    expect(existsSync(join(dbRestore.emergency_backup, "signguy.sqlite-wal"))).toBe(true);
    expect(existsSync(`${restoreDbPath}-wal`)).toBe(false);
    expect(existsSync(`${restoreDbPath}-shm`)).toBe(false);
    expect(attachmentRestore.emergency_backup).toBe(null);
    const restoredDb = new DatabaseSync(restoreDbPath);
    try {
      expect(restoredDb.prepare("SELECT COUNT(*) AS count FROM customers").get().count).toBe(1);
      expect(restoredDb.prepare("PRAGMA quick_check").get().quick_check).toBe("ok");
    } finally {
      restoredDb.close();
    }
    const restoredFiles = readdirSync(restoreAttachmentsRoot, { recursive: true });
    expect(restoredFiles.some((file) => String(file).endsWith(".txt"))).toBe(true);
  });

  it("requires explicit confirmation before restoring server files", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "server-backups");
    const backup = createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot });
    expect(() => restoreDatabaseBackup({ inputPath: backup.path, targetDbPath: join(runtime.root, "restore.sqlite"), backupRoot })).toThrow("server_restore_confirmation_required");
    expect(() => restoreAttachmentsBackup({ inputPath: backup.path, targetRoot: join(runtime.root, "restore-attachments"), backupRoot })).toThrow("server_restore_confirmation_required");
  });

  it("rejects corrupted attachment backups and symlinked attachment entries", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "server-backups");
    const backup = createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot });
    const manifest = JSON.parse(readFileSync(join(backup.path, "attachments-manifest.json"), "utf8"));
    const copiedAttachment = join(backup.path, "attachments", ...manifest.files[0].relative_path.split("/"));
    writeFileSync(copiedAttachment, "corrupted");
    expect(() => restoreAttachmentsBackup({
      inputPath: backup.path,
      targetRoot: join(runtime.root, "restore-attachments"),
      backupRoot,
      confirmation: "RESTORE_ATTACHMENTS",
    })).toThrow("server_backup_attachment_checksum_mismatch");

    const symlinkRoot = join(runtime.root, "symlink-source");
    const outside = join(runtime.root, "outside.txt");
    const link = join(symlinkRoot, "link.txt");
    mkdirSync(symlinkRoot, { recursive: true });
    writeFileSync(outside, "outside", { flag: "wx" });
    try {
      writeFileSync(join(symlinkRoot, "anchor.txt"), "anchor", { flag: "wx" });
      symlinkSync(outside, link);
    } catch {
      return;
    }
    expect(() => createAttachmentBackup({ sourceRoot: symlinkRoot, backupRoot: join(runtime.root, "symlink-backups") })).toThrow("server_backup_attachment_symlink");
  });

  it("applies retain-last cleanup only to completed backup sets under the configured root", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "retained-backups");
    createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 2 });
    createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 2 });
    const third = createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 2 });
    const backupSets = readdirSync(backupRoot).filter((name) => !name.endsWith(".partial"));
    expect(backupSets).toHaveLength(2);
    expect(third.retention_removed).toHaveLength(1);
  });

  it("retention ignores partial, missing-metadata, and malformed-metadata directories", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "retention-safety");
    createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 99 });
    createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 99 });
    createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot, retainLast: 99 });
    const missing = join(backupRoot, "missing-metadata");
    const malformed = join(backupRoot, "malformed-metadata");
    const partial = join(backupRoot, "unfinished.partial");
    mkdirSync(missing);
    mkdirSync(malformed);
    mkdirSync(partial);
    writeFileSync(join(malformed, "backup-metadata.json"), "{bad", { flag: "wx" });

    const removed = applyBackupRetention(backupRoot, 1);
    expect(removed).toHaveLength(2);
    expect(existsSync(missing)).toBe(true);
    expect(existsSync(malformed)).toBe(true);
    expect(existsSync(partial)).toBe(true);
    const validSets = readdirSync(backupRoot)
      .filter((name) => !["missing-metadata", "malformed-metadata", "unfinished.partial"].includes(name));
    expect(validSets).toHaveLength(1);
  });

  it("keeps customer portable backups separate from server backup artifacts", async () => {
    const runtime = await seededRuntime();
    const passphrase = "long-passphrase-release-a";
    const portableBackup = runtime.service.createBackup(runtime.actor, {
      passphrase,
      passphrase_confirmation: passphrase,
    });
    runtime.db.close();
    createServerBackup({
      dbPath: runtime.dbPath,
      sourceRoot: runtime.attachmentsRoot,
      backupRoot: join(runtime.root, "server-backups"),
    });

    const payload = decryptBackup(portableBackup.buffer, passphrase);
    expect(payload.manifest.backup_format_version).toBe("signguy-slim-backup-v1");
    expect(payload.manifest.portable_contract_version).toBe("1.0.0");
    expect(payload.attachments[0].metadata.sha256).toBe(runtime.attachment.sha256);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/server-backup|SIGNGUY_SLIM_DB_PATH|csrf_token|token_hash|Set-Cookie/i);
    expect(statSync(join(runtime.root, "server-backups")).isDirectory()).toBe(true);
    expect(sha256File(join(runtime.root, "server-backups", readdirSync(join(runtime.root, "server-backups"))[0], "database.sqlite"))).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows first production migration and backs up an existing database before later migrations", () => {
    const root = tempDir();
    const dbPath = join(root, "runtime", "signguy.sqlite");
    const sourceRoot = join(root, "attachments");
    const backupRoot = join(root, "server-backups");
    const first = migrateProductionDatabase({ dbPath, sourceRoot, backupRoot });
    expect(first.backup).toBe(null);
    expect(first.backup_skipped).toBe("database_missing_initial_migration");
    const second = migrateProductionDatabase({ dbPath, sourceRoot, backupRoot });
    expect(second.backup.metadata.backup_type).toBe("full");
    expect(readdirSync(backupRoot).filter((name) => !name.endsWith(".partial"))).toHaveLength(1);
  });

  it("does not treat an existing corrupt database as first deploy during production migration", () => {
    const root = tempDir();
    const dbPath = join(root, "runtime", "signguy.sqlite");
    const sourceRoot = join(root, "attachments");
    const backupRoot = join(root, "server-backups");
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(dbPath, "not sqlite", { flag: "wx" });
    expect(() => migrateProductionDatabase({ dbPath, sourceRoot, backupRoot })).toThrow();
    expect(readFileSync(dbPath, "utf8")).toBe("not sqlite");
    expect(existsSync(backupRoot)).toBe(true);
    expect(readdirSync(backupRoot).filter((name) => !name.endsWith(".partial"))).toHaveLength(0);
  });

  it("rejects manifest traversal and absolute paths during attachment restore validation", () => {
    const root = tempDir();
    const backupRoot = join(root, "backups");
    for (const [index, relativePath] of ["../escape.txt", "..\\escape.txt", "/absolute.txt", "C:/absolute.txt", "//server/share/file.txt"].entries()) {
      const set = join(backupRoot, `bad-${index}`);
      mkdirSync(join(set, "attachments"), { recursive: true });
      writeFileSync(join(set, "backup-metadata.json"), `${JSON.stringify(metadata("attachments", `bad-${index}`))}\n`, { flag: "wx" });
      writeFileSync(join(set, "attachments-manifest.json"), `${JSON.stringify({
        created_at: new Date().toISOString(),
        source_root_sha256: "0".repeat(64),
        file_count: 1,
        total_bytes: 1,
        files: [{ relative_path: relativePath, byte_size: 1, sha256: "0".repeat(64) }],
      })}\n`, { flag: "wx" });
      expect(() => verifyAttachmentBackup(set)).toThrow(/server_backup_attachment_(path|manifest)_invalid/);
      expect(() => restoreAttachmentsBackup({
        inputPath: set,
        targetRoot: join(root, `restore-${index}`),
        backupRoot,
        confirmation: "RESTORE_ATTACHMENTS",
      })).toThrow();
    }
  });

  it("fails a full server backup when database attachment records are missing from copied bytes", async () => {
    const runtime = await seededRuntime();
    const row = runtime.db.prepare("SELECT storage_key FROM order_attachments WHERE id = ?").get(runtime.attachment.id);
    runtime.db.close();
    rmSync(join(runtime.attachmentsRoot, ...row.storage_key.split("/")), { force: true });
    expect(() => createServerBackup({
      dbPath: runtime.dbPath,
      sourceRoot: runtime.attachmentsRoot,
      backupRoot: join(runtime.root, "coherence-backups"),
    })).toThrow("server_backup_attachment_database_mismatch");
  });

  it("validates the full backup set before combined restore mutates target files", async () => {
    const runtime = await seededRuntime();
    runtime.db.close();
    const backupRoot = join(runtime.root, "combined-backups");
    const backup = createServerBackup({ dbPath: runtime.dbPath, sourceRoot: runtime.attachmentsRoot, backupRoot });
    writeFileSync(join(backup.path, "attachments-manifest.json"), "{bad");
    const targetDb = join(runtime.root, "restore", "signguy.sqlite");
    mkdirSync(dirname(targetDb), { recursive: true });
    writeFileSync(targetDb, "old-db", { flag: "wx" });
    expect(() => restoreServerBackup({
      inputPath: backup.path,
      targetDbPath: targetDb,
      targetRoot: join(runtime.root, "restore-attachments"),
      backupRoot,
      confirmation: "RESTORE_SERVER_BACKUP",
    })).toThrow("server_backup_attachment_manifest_invalid");
    expect(readFileSync(targetDb, "utf8")).toBe("old-db");
  });
});
