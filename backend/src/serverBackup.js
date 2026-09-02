import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, serverBackupRetainLast, serverBackupRoot, attachmentRoot, isInsidePath, ROOT } from "./config.js";
import { openDatabase, runMigrations } from "./db.js";

const BACKUP_METADATA_FILE = "backup-metadata.json";
const ATTACHMENT_MANIFEST_FILE = "attachments-manifest.json";
const DATABASE_BACKUP_FILE = "database.sqlite";
const ATTACHMENTS_DIR = "attachments";
const RESTORE_DATABASE_CONFIRMATION = "RESTORE_DATABASE";
const RESTORE_ATTACHMENTS_CONFIRMATION = "RESTORE_ATTACHMENTS";
const RESTORE_SERVER_CONFIRMATION = "RESTORE_SERVER_BACKUP";

function nowIso() {
  return new Date().toISOString();
}

function backupSetId(prefix = "server-backup") {
  return `${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z")}-${prefix}-${randomUUID().slice(0, 8)}`;
}

function hashString(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function assertInside(root, candidate, code = "server_backup_path_invalid") {
  if (!isInsidePath(root, candidate)) throw new Error(code);
  return resolve(candidate);
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  if (lstatSync(path).isSymbolicLink()) throw new Error("server_backup_path_invalid");
  return realpathSync(path);
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function assertRegularFile(path, code = "server_backup_file_invalid") {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(code);
}

function assertPlainDirectory(path, code = "server_backup_path_invalid") {
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error(code);
}

export function verifySqliteDatabase(path) {
  assertRegularFile(path, "server_backup_database_missing");
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare("PRAGMA quick_check").get();
    const result = Object.values(row || {})[0];
    if (result !== "ok") throw new Error("server_backup_database_invalid");
    return result;
  } finally {
    db.close();
  }
}

function schemaMigrationIds(path) {
  const db = new DatabaseSync(path);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!table) return [];
    return db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((row) => row.id);
  } finally {
    db.close();
  }
}

export function backupSqliteDatabase(sourceDbPath, destinationFile) {
  if (!sourceDbPath || sourceDbPath === ":memory:") throw new Error("server_backup_database_file_required");
  const source = resolve(sourceDbPath);
  assertRegularFile(source, "server_backup_database_missing");
  const destination = resolve(destinationFile);
  if (existsSync(destination)) throw new Error("server_backup_destination_exists");
  ensureParent(destination);
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("VACUUM INTO ?").run(destination);
  } finally {
    db.close();
  }
  verifySqliteDatabase(destination);
  return {
    filename: basename(destination),
    byte_size: statSync(destination).size,
    sha256: sha256File(destination),
    quick_check: "ok",
    schema_migrations: schemaMigrationIds(destination),
    source_path_sha256: hashString(source),
  };
}

function sortedDirectoryEntries(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function listAttachmentFiles(root) {
  const realRoot = ensureDirectory(root);
  const files = [];
  const walk = (current) => {
    for (const entry of sortedDirectoryEntries(current)) {
      const fullPath = join(current, entry.name);
      const resolved = assertInside(realRoot, fullPath, "server_backup_attachment_path_invalid");
      if (entry.isSymbolicLink() || lstatSync(resolved).isSymbolicLink()) throw new Error("server_backup_attachment_symlink");
      if (entry.isDirectory()) {
        walk(resolved);
      } else if (entry.isFile()) {
        const rel = relative(realRoot, resolved).split(sep).join("/");
        if (!rel || rel.startsWith("../") || rel.includes("/../")) throw new Error("server_backup_attachment_path_invalid");
        files.push({ rel, fullPath: resolved });
      }
    }
  };
  walk(realRoot);
  return { realRoot, files };
}

export function backupAttachmentsToDirectory(sourceRoot, destinationRoot) {
  const destination = resolve(destinationRoot);
  ensureDirectory(destination);
  const { realRoot, files } = listAttachmentFiles(sourceRoot);
  const manifestFiles = [];
  let totalBytes = 0;
  for (const file of files) {
    const destinationPath = assertInside(destination, join(destination, ...file.rel.split("/")), "server_backup_attachment_path_invalid");
    ensureParent(destinationPath);
    copyFileSync(file.fullPath, destinationPath);
    const size = statSync(destinationPath).size;
    const sha256 = sha256File(destinationPath);
    if (sha256 !== sha256File(file.fullPath)) throw new Error("server_backup_attachment_checksum_mismatch");
    totalBytes += size;
    manifestFiles.push({ relative_path: file.rel, byte_size: size, sha256 });
  }
  const manifest = {
    created_at: nowIso(),
    source_root_sha256: hashString(realRoot),
    file_count: manifestFiles.length,
    total_bytes: totalBytes,
    files: manifestFiles,
  };
  const manifestPath = join(dirname(destination), ATTACHMENT_MANIFEST_FILE);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  verifyAttachmentBackup(dirname(destination));
  return {
    directory: ATTACHMENTS_DIR,
    manifest_file: ATTACHMENT_MANIFEST_FILE,
    manifest_sha256: sha256File(manifestPath),
    file_count: manifest.file_count,
    total_bytes: manifest.total_bytes,
    source_root_sha256: manifest.source_root_sha256,
  };
}

export function verifyAttachmentBackup(backupSetPath) {
  const setPath = resolve(backupSetPath);
  const manifestPath = join(setPath, ATTACHMENT_MANIFEST_FILE);
  const attachmentsPath = join(setPath, ATTACHMENTS_DIR);
  assertRegularFile(manifestPath, "server_backup_attachment_manifest_missing");
  assertPlainDirectory(attachmentsPath, "server_backup_attachments_missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error("server_backup_attachment_manifest_invalid");
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.relative_path !== "string" || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || ""))) {
      throw new Error("server_backup_attachment_manifest_invalid");
    }
    const fullPath = assertInside(attachmentsPath, join(attachmentsPath, ...file.relative_path.split("/")), "server_backup_attachment_path_invalid");
    assertRegularFile(fullPath, "server_backup_attachment_missing");
    if (sha256File(fullPath) !== file.sha256) throw new Error("server_backup_attachment_checksum_mismatch");
    totalBytes += statSync(fullPath).size;
  }
  if (Number(manifest.file_count) !== manifest.files.length || Number(manifest.total_bytes) !== totalBytes) {
    throw new Error("server_backup_attachment_manifest_invalid");
  }
  return manifest;
}

function writeBackupMetadata(setPath, metadata) {
  const path = join(setPath, BACKUP_METADATA_FILE);
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  return { ...metadata, metadata_sha256: sha256File(path) };
}

function baseMetadata(type, id) {
  return {
    backup_format: "signguy-slim-server-backup",
    backup_format_version: "1.0.0",
    backup_type: type,
    backup_set_id: id,
    created_at: nowIso(),
    app: {
      name: "signguy-slim",
      version: packageVersion(),
      commit: process.env.SIGNGUY_SLIM_COMMIT_SHA || process.env.GITHUB_SHA || "unknown",
    },
    runtime: {
      node: process.version,
    },
  };
}

function createBackupSet(root, prefix, work) {
  const backupRootPath = ensureDirectory(root);
  const id = backupSetId(prefix);
  const partialPath = join(backupRootPath, `${id}.partial`);
  const finalPath = join(backupRootPath, id);
  assertInside(backupRootPath, partialPath);
  assertInside(backupRootPath, finalPath);
  mkdirSync(partialPath, { recursive: false });
  try {
    const result = work(partialPath, id);
    renameSync(partialPath, finalPath);
    return { ...result, backup_set_id: id, path: finalPath };
  } catch (error) {
    rmSync(partialPath, { recursive: true, force: true });
    throw error;
  }
}

export function applyBackupRetention(root = serverBackupRoot(), retainLast = serverBackupRetainLast()) {
  if (!retainLast) return [];
  const backupRootPath = ensureDirectory(root);
  const candidates = sortedDirectoryEntries(backupRootPath)
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".partial"))
    .map((entry) => join(backupRootPath, entry.name))
    .filter((path) => existsSync(join(path, BACKUP_METADATA_FILE)))
    .map((path) => {
      try {
        return { path, created_at: JSON.parse(readFileSync(join(path, BACKUP_METADATA_FILE), "utf8")).created_at || basename(path) };
      } catch {
        return { path, created_at: basename(path) };
      }
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const removed = [];
  for (const stale of candidates.slice(0, Math.max(0, candidates.length - retainLast))) {
    assertInside(backupRootPath, stale.path);
    rmSync(stale.path, { recursive: true, force: true });
    removed.push(stale.path);
  }
  return removed;
}

export function createDatabaseBackup({ dbPath = databasePath(), backupRoot = serverBackupRoot(), retainLast = serverBackupRetainLast() } = {}) {
  const result = createBackupSet(backupRoot, "database", (setPath, id) => {
    const database = backupSqliteDatabase(dbPath, join(setPath, DATABASE_BACKUP_FILE));
    const metadata = writeBackupMetadata(setPath, {
      ...baseMetadata("database", id),
      database,
      attachments: null,
    });
    return { metadata };
  });
  result.retention_removed = applyBackupRetention(backupRoot, retainLast);
  return result;
}

export function createAttachmentBackup({ sourceRoot = attachmentRoot(), backupRoot = serverBackupRoot(), retainLast = serverBackupRetainLast() } = {}) {
  const result = createBackupSet(backupRoot, "attachments", (setPath, id) => {
    const attachments = backupAttachmentsToDirectory(sourceRoot, join(setPath, ATTACHMENTS_DIR));
    const metadata = writeBackupMetadata(setPath, {
      ...baseMetadata("attachments", id),
      database: null,
      attachments,
    });
    return { metadata };
  });
  result.retention_removed = applyBackupRetention(backupRoot, retainLast);
  return result;
}

export function createServerBackup({ dbPath = databasePath(), sourceRoot = attachmentRoot(), backupRoot = serverBackupRoot(), retainLast = serverBackupRetainLast() } = {}) {
  const result = createBackupSet(backupRoot, "full", (setPath, id) => {
    const database = backupSqliteDatabase(dbPath, join(setPath, DATABASE_BACKUP_FILE));
    const attachments = backupAttachmentsToDirectory(sourceRoot, join(setPath, ATTACHMENTS_DIR));
    const metadata = writeBackupMetadata(setPath, {
      ...baseMetadata("full", id),
      database,
      attachments,
    });
    return { metadata };
  });
  result.retention_removed = applyBackupRetention(backupRoot, retainLast);
  return result;
}

function resolveBackupInput(inputPath, backupRootPath = serverBackupRoot()) {
  if (!inputPath) throw new Error("server_backup_path_required");
  const root = ensureDirectory(backupRootPath);
  const resolved = assertInside(root, resolve(inputPath), "server_backup_path_invalid");
  if (!existsSync(resolved)) throw new Error("server_backup_path_missing");
  return resolved;
}

function databaseBackupFile(inputPath, backupRootPath) {
  const resolved = resolveBackupInput(inputPath, backupRootPath);
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink()) throw new Error("server_backup_path_invalid");
  if (stats.isDirectory()) return assertInside(resolved, join(resolved, DATABASE_BACKUP_FILE));
  return resolved;
}

function attachmentBackupSet(inputPath, backupRootPath) {
  const resolved = resolveBackupInput(inputPath, backupRootPath);
  if (!lstatSync(resolved).isDirectory() || lstatSync(resolved).isSymbolicLink()) throw new Error("server_backup_path_invalid");
  verifyAttachmentBackup(resolved);
  return resolved;
}

function restoreSuffix() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
}

export function restoreDatabaseBackup({ inputPath, targetDbPath = databasePath(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_DATABASE_CONFIRMATION && confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  if (!targetDbPath || targetDbPath === ":memory:") throw new Error("server_restore_database_file_required");
  const source = databaseBackupFile(inputPath, backupRoot);
  verifySqliteDatabase(source);
  const target = resolve(targetDbPath);
  const parent = ensureDirectory(dirname(target));
  assertInside(parent, target);
  const tempTarget = join(parent, `.${basename(target)}.restore-${randomUUID()}.tmp`);
  const emergency = join(parent, `${basename(target)}.pre-restore-${restoreSuffix()}`);
  let movedCurrent = false;
  try {
    copyFileSync(source, tempTarget);
    verifySqliteDatabase(tempTarget);
    if (existsSync(target)) {
      if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) throw new Error("server_restore_target_invalid");
      renameSync(target, emergency);
      movedCurrent = true;
    }
    renameSync(tempTarget, target);
    return { restored: target, emergency_backup: movedCurrent ? emergency : null, quick_check: "ok" };
  } catch (error) {
    rmSync(tempTarget, { force: true });
    if (movedCurrent && !existsSync(target) && existsSync(emergency)) renameSync(emergency, target);
    throw error;
  }
}

function copyAttachmentBackup(sourceSet, targetRoot) {
  const attachmentsSource = join(sourceSet, ATTACHMENTS_DIR);
  const manifest = verifyAttachmentBackup(sourceSet);
  const target = resolve(targetRoot);
  const parent = ensureDirectory(dirname(target));
  const tempTarget = join(parent, `.${basename(target)}.restore-${randomUUID()}.tmp`);
  mkdirSync(tempTarget, { recursive: false });
  try {
    for (const file of manifest.files) {
      const sourcePath = assertInside(attachmentsSource, join(attachmentsSource, ...file.relative_path.split("/")), "server_backup_attachment_path_invalid");
      const destinationPath = assertInside(tempTarget, join(tempTarget, ...file.relative_path.split("/")), "server_backup_attachment_path_invalid");
      ensureParent(destinationPath);
      copyFileSync(sourcePath, destinationPath);
    }
    let totalBytes = 0;
    for (const file of manifest.files) {
      const destinationPath = assertInside(tempTarget, join(tempTarget, ...file.relative_path.split("/")), "server_backup_attachment_path_invalid");
      if (sha256File(destinationPath) !== file.sha256) throw new Error("server_backup_attachment_checksum_mismatch");
      totalBytes += statSync(destinationPath).size;
    }
    if (totalBytes !== Number(manifest.total_bytes)) throw new Error("server_backup_attachment_manifest_invalid");
    return tempTarget;
  } catch (error) {
    rmSync(tempTarget, { recursive: true, force: true });
    throw error;
  }
}

export function restoreAttachmentsBackup({ inputPath, targetRoot = attachmentRoot(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_ATTACHMENTS_CONFIRMATION && confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  const sourceSet = attachmentBackupSet(inputPath, backupRoot);
  const target = resolve(targetRoot);
  const parent = ensureDirectory(dirname(target));
  assertInside(parent, target);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("server_restore_target_invalid");
  const tempTarget = copyAttachmentBackup(sourceSet, target);
  const emergency = join(parent, `${basename(target)}.pre-restore-${restoreSuffix()}`);
  let movedCurrent = false;
  try {
    if (existsSync(target)) {
      if (!lstatSync(target).isDirectory()) throw new Error("server_restore_target_invalid");
      renameSync(target, emergency);
      movedCurrent = true;
    }
    renameSync(tempTarget, target);
    return { restored: target, emergency_backup: movedCurrent ? emergency : null };
  } catch (error) {
    rmSync(tempTarget, { recursive: true, force: true });
    if (movedCurrent && !existsSync(target) && existsSync(emergency)) renameSync(emergency, target);
    throw error;
  }
}

export function restoreServerBackup({ inputPath, targetDbPath = databasePath(), targetRoot = attachmentRoot(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  const sourceSet = attachmentBackupSet(inputPath, backupRoot);
  verifySqliteDatabase(databaseBackupFile(sourceSet, backupRoot));
  const database = restoreDatabaseBackup({ inputPath: sourceSet, targetDbPath, backupRoot, confirmation });
  const attachments = restoreAttachmentsBackup({ inputPath: sourceSet, targetRoot, backupRoot, confirmation });
  return { database, attachments };
}

export function migrateProductionDatabase({
  dbPath = databasePath(),
  sourceRoot = attachmentRoot(),
  backupRoot = serverBackupRoot(),
  retainLast = serverBackupRetainLast(),
  createBackup = true,
} = {}) {
  let backup = null;
  let backupSkipped = null;
  if (createBackup && existsSync(dbPath)) {
    backup = createServerBackup({ dbPath, sourceRoot, backupRoot, retainLast });
  } else if (createBackup) {
    backupSkipped = "database_missing_initial_migration";
  }
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }
  return { backup, backup_skipped: backupSkipped, migrated: dbPath };
}

export {
  ATTACHMENT_MANIFEST_FILE,
  ATTACHMENTS_DIR,
  BACKUP_METADATA_FILE,
  DATABASE_BACKUP_FILE,
  RESTORE_ATTACHMENTS_CONFIRMATION,
  RESTORE_DATABASE_CONFIRMATION,
  RESTORE_SERVER_CONFIRMATION,
};
