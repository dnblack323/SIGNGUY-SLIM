import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, serverBackupRetainLast, serverBackupRoot, attachmentRoot, isInsidePath, ROOT } from "./config.js";
import { openDatabase, pendingMigrationIds, runMigrations } from "./db.js";

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
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
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

function parseJsonFile(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(code);
  }
}

function normalizeManifestRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("server_backup_attachment_manifest_invalid");
  if (value.includes("\\") || isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith("//")) {
    throw new Error("server_backup_attachment_path_invalid");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("server_backup_attachment_path_invalid");
  return parts;
}

function ensureDirectory(path, mode) {
  mkdirSync(path, { recursive: true, mode });
  if (lstatSync(path).isSymbolicLink()) throw new Error("server_backup_path_invalid");
  if (mode !== undefined) chmodSync(path, mode);
  return realpathSync(path);
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function ensurePrivateDirectory(path) {
  return ensureDirectory(path, 0o700);
}

function ensurePrivateParent(path) {
  ensurePrivateDirectory(dirname(path));
}

function writePrivateFile(path, data) {
  writeFileSync(path, data, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
}

function copyPrivateFile(source, destination) {
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

function assertRegularFile(path, code = "server_backup_file_invalid") {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(code);
}

function assertPlainDirectory(path, code = "server_backup_path_invalid") {
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error(code);
}

function requirePlainDirectory(path, code = "server_backup_path_invalid") {
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error(code);
  return realpathSync(path);
}

function assertNoSymlinkPath(root, candidate, code = "server_backup_path_invalid") {
  const parts = relative(root, candidate).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(code);
  }
}

function pathExistsOrDanglingSymlink(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readBackupMetadata(setPath, allowedTypes = ["database", "attachments", "full"]) {
  const metadataPath = join(setPath, BACKUP_METADATA_FILE);
  assertRegularFile(metadataPath, "server_backup_metadata_missing");
  const metadata = parseJsonFile(metadataPath, "server_backup_metadata_invalid");
  if (
    metadata?.backup_format !== "signguy-slim-server-backup" ||
    metadata?.backup_format_version !== "1.0.0" ||
    typeof metadata?.backup_set_id !== "string" ||
    !allowedTypes.includes(metadata?.backup_type)
  ) {
    throw new Error("server_backup_metadata_invalid");
  }
  return metadata;
}

function verifyDatabaseMetadata(databaseFile, metadata) {
  const expected = metadata?.database;
  if (!expected || expected.filename !== DATABASE_BACKUP_FILE || !/^[a-f0-9]{64}$/i.test(String(expected.sha256 || ""))) {
    throw new Error("server_backup_metadata_invalid");
  }
  assertRegularFile(databaseFile, "server_backup_database_missing");
  if (Number(expected.byte_size) !== statSync(databaseFile).size || String(expected.sha256).toLowerCase() !== sha256File(databaseFile)) {
    throw new Error("server_backup_database_checksum_mismatch");
  }
}

function verifyAttachmentMetadata(setPath, metadata, manifest) {
  const expected = metadata?.attachments;
  if (!expected || expected.directory !== ATTACHMENTS_DIR || expected.manifest_file !== ATTACHMENT_MANIFEST_FILE || !/^[a-f0-9]{64}$/i.test(String(expected.manifest_sha256 || ""))) {
    throw new Error("server_backup_metadata_invalid");
  }
  const manifestPath = join(setPath, ATTACHMENT_MANIFEST_FILE);
  if (String(expected.manifest_sha256).toLowerCase() !== sha256File(manifestPath)) {
    throw new Error("server_backup_attachment_manifest_checksum_mismatch");
  }
  if (Number(expected.file_count) !== manifest.files.length || Number(expected.total_bytes) !== Number(manifest.total_bytes)) {
    throw new Error("server_backup_metadata_invalid");
  }
}

function validCompletedBackupSet(setPath) {
  try {
    const metadata = readBackupMetadata(setPath);
    if (metadata.backup_type === "database" || metadata.backup_type === "full") {
      verifyDatabaseMetadata(join(setPath, DATABASE_BACKUP_FILE), metadata);
    }
    if (metadata.backup_type === "attachments" || metadata.backup_type === "full") {
      const manifest = verifyAttachmentBackup(setPath);
      verifyAttachmentMetadata(setPath, metadata, manifest);
    }
    return metadata;
  } catch {
    return null;
  }
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

function verifyKnownSqliteMigrations(path) {
  const db = new DatabaseSync(path);
  try {
    pendingMigrationIds(db);
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
  chmodSync(destination, 0o600);
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
  const realRoot = requirePlainDirectory(root, "server_backup_attachments_missing");
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
        normalizeManifestRelativePath(rel);
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
    ensurePrivateParent(destinationPath);
    copyPrivateFile(file.fullPath, destinationPath);
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
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  const realAttachmentsPath = realpathSync(attachmentsPath);
  const manifest = parseJsonFile(manifestPath, "server_backup_attachment_manifest_invalid");
  if (!Array.isArray(manifest.files)) throw new Error("server_backup_attachment_manifest_invalid");
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.relative_path !== "string" || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || ""))) {
      throw new Error("server_backup_attachment_manifest_invalid");
    }
    const fullPath = assertInside(attachmentsPath, join(attachmentsPath, ...normalizeManifestRelativePath(file.relative_path)), "server_backup_attachment_path_invalid");
    assertNoSymlinkPath(attachmentsPath, fullPath, "server_backup_attachment_symlink");
    assertRegularFile(fullPath, "server_backup_attachment_missing");
    if (!isInsidePath(realAttachmentsPath, realpathSync(fullPath))) throw new Error("server_backup_attachment_symlink");
    if (sha256File(fullPath) !== file.sha256) throw new Error("server_backup_attachment_checksum_mismatch");
    totalBytes += statSync(fullPath).size;
  }
  if (Number(manifest.file_count) !== manifest.files.length || Number(manifest.total_bytes) !== totalBytes) {
    throw new Error("server_backup_attachment_manifest_invalid");
  }
  return manifest;
}

function activeAttachmentRows(databaseFile) {
  const db = new DatabaseSync(databaseFile);
  try {
    const rows = [];
    const hasOrderAttachments = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_attachments'").get();
    if (hasOrderAttachments) {
      rows.push(...db
        .prepare("SELECT 'order_attachment' AS source, storage_key, byte_size, sha256 FROM order_attachments WHERE deleted_at IS NULL ORDER BY storage_key")
        .all());
    }
    const hasIntakeAttachments = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'intake_attachments'").get();
    if (hasIntakeAttachments) {
      rows.push(...db
        .prepare("SELECT 'intake_attachment' AS source, storage_key, byte_size, sha256 FROM intake_attachments WHERE accepted = 1 AND storage_key IS NOT NULL ORDER BY storage_key")
        .all());
    }
    return rows;
  } finally {
    db.close();
  }
}

function verifyDatabaseAttachmentCoherence(databaseFile, attachmentManifest) {
  const filesByPath = new Map();
  for (const file of attachmentManifest.files) {
    filesByPath.set(file.relative_path, file);
  }
  const rows = activeAttachmentRows(databaseFile);
  for (const row of rows) {
    const relativePath = normalizeManifestRelativePath(String(row.storage_key || "")).join("/");
    const file = filesByPath.get(relativePath);
    if (!file || Number(file.byte_size) !== Number(row.byte_size) || String(file.sha256).toLowerCase() !== String(row.sha256).toLowerCase()) {
      throw new Error("server_backup_attachment_database_mismatch");
    }
  }
  return {
    checked_database_attachment_rows: rows.length,
    extra_manifest_files: Math.max(0, attachmentManifest.files.length - rows.length),
  };
}

function writeBackupMetadata(setPath, metadata) {
  const path = join(setPath, BACKUP_METADATA_FILE);
  writePrivateFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
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
  const backupRootPath = ensurePrivateDirectory(root);
  const id = backupSetId(prefix);
  const partialPath = join(backupRootPath, `${id}.partial`);
  const finalPath = join(backupRootPath, id);
  assertInside(backupRootPath, partialPath);
  assertInside(backupRootPath, finalPath);
  mkdirSync(partialPath, { recursive: false, mode: 0o700 });
  chmodSync(partialPath, 0o700);
  try {
    const result = work(partialPath, id);
    renameSync(partialPath, finalPath);
    return { ...result, backup_set_id: id, path: finalPath };
  } catch (error) {
    rmSync(partialPath, { recursive: true, force: true });
    throw error;
  }
}

export function applyBackupRetention(root = serverBackupRoot(), retainLast = serverBackupRetainLast(), { preservePaths = [] } = {}) {
  if (retainLast === 0) return [];
  const backupRootPath = ensureDirectory(root);
  const preserved = new Set(preservePaths.map((path) => resolve(path)));
  const candidates = sortedDirectoryEntries(backupRootPath)
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.endsWith(".partial"))
    .map((entry) => join(backupRootPath, entry.name))
    .filter((path) => validCompletedBackupSet(path))
    .map((path) => {
      const metadata = readBackupMetadata(path);
      return { path, created_at: metadata.created_at || basename(path), backup_set_id: metadata.backup_set_id };
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const removed = [];
  for (const stale of candidates) {
    if (candidates.length - removed.length <= retainLast) break;
    if (preserved.has(resolve(stale.path))) continue;
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
  result.retention_removed = applyBackupRetention(backupRoot, retainLast, { preservePaths: [result.path] });
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
  result.retention_removed = applyBackupRetention(backupRoot, retainLast, { preservePaths: [result.path] });
  return result;
}

export function createServerBackup({ dbPath = databasePath(), sourceRoot = attachmentRoot(), backupRoot = serverBackupRoot(), retainLast = serverBackupRetainLast() } = {}) {
  const result = createBackupSet(backupRoot, "full", (setPath, id) => {
    const databasePath = join(setPath, DATABASE_BACKUP_FILE);
    const database = backupSqliteDatabase(dbPath, databasePath);
    const attachments = backupAttachmentsToDirectory(sourceRoot, join(setPath, ATTACHMENTS_DIR));
    const attachmentManifest = verifyAttachmentBackup(setPath);
    const coherence = verifyDatabaseAttachmentCoherence(databasePath, attachmentManifest);
    const metadata = writeBackupMetadata(setPath, {
      ...baseMetadata("full", id),
      database: { ...database, attachment_coherence: coherence },
      attachments,
    });
    return { metadata };
  });
  result.retention_removed = applyBackupRetention(backupRoot, retainLast, { preservePaths: [result.path] });
  return result;
}

function resolveBackupInput(inputPath, backupRootPath = serverBackupRoot()) {
  if (!inputPath) throw new Error("server_backup_path_required");
  const lexicalRoot = resolve(backupRootPath);
  const root = ensureDirectory(lexicalRoot);
  const resolved = resolve(inputPath);
  if (!isInsidePath(lexicalRoot, resolved) && !isInsidePath(root, resolved)) throw new Error("server_backup_path_invalid");
  if (!existsSync(resolved)) throw new Error("server_backup_path_missing");
  return assertInside(root, realpathSync(resolved), "server_backup_path_invalid");
}

function databaseBackupFile(inputPath, backupRootPath) {
  const resolved = resolveBackupInput(inputPath, backupRootPath);
  const stats = lstatSync(resolved);
  let metadata;
  let databaseFile;
  if (stats.isSymbolicLink()) throw new Error("server_backup_path_invalid");
  if (stats.isDirectory()) {
    metadata = readBackupMetadata(resolved, ["database", "full"]);
    databaseFile = assertInside(resolved, join(resolved, DATABASE_BACKUP_FILE));
  } else {
    const parent = dirname(resolved);
    metadata = readBackupMetadata(parent, ["database", "full"]);
    if (basename(resolved) !== DATABASE_BACKUP_FILE) throw new Error("server_backup_path_invalid");
    databaseFile = resolved;
  }
  verifyDatabaseMetadata(databaseFile, metadata);
  assertNoDatabaseSidecars(databaseFile, "server_backup_database_sidecar_invalid");
  return databaseFile;
}

function attachmentBackupSet(inputPath, backupRootPath) {
  const resolved = resolveBackupInput(inputPath, backupRootPath);
  if (!lstatSync(resolved).isDirectory() || lstatSync(resolved).isSymbolicLink()) throw new Error("server_backup_path_invalid");
  const metadata = readBackupMetadata(resolved, ["attachments", "full"]);
  const manifest = verifyAttachmentBackup(resolved);
  verifyAttachmentMetadata(resolved, metadata, manifest);
  return resolved;
}

function restoreSuffix() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
}

function databaseSidecarPaths(target) {
  return [`${target}-wal`, `${target}-shm`, `${target}-journal`];
}

function assertNoDatabaseSidecars(target, code = "server_restore_target_invalid") {
  for (const sidecar of databaseSidecarPaths(target)) {
    if (pathExistsOrDanglingSymlink(sidecar)) throw new Error(code);
  }
}

function stageDatabaseRestore(source, targetDbPath) {
  if (!targetDbPath || targetDbPath === ":memory:") throw new Error("server_restore_database_file_required");
  const requestedTarget = resolve(targetDbPath);
  const parent = ensureDirectory(dirname(requestedTarget));
  const target = join(parent, basename(requestedTarget));
  assertInside(parent, target);
  const tempTarget = join(parent, `.${basename(target)}.restore-${randomUUID()}.tmp`);
  assertInside(parent, tempTarget);
  copyFileSync(source, tempTarget);
  chmodSync(tempTarget, 0o600);
  verifySqliteDatabase(tempTarget);
  verifyKnownSqliteMigrations(tempTarget);
  for (const sidecar of databaseSidecarPaths(tempTarget)) rmSync(sidecar, { force: true });
  return { target, parent, tempTarget };
}

function moveCurrentDatabaseToEmergency(target, parent) {
  const emergency = join(parent, `${basename(target)}.pre-restore-${restoreSuffix()}`);
  const currentPaths = [target, ...databaseSidecarPaths(target)].filter((path) => pathExistsOrDanglingSymlink(path));
  if (!currentPaths.length) return null;
  for (const current of currentPaths) {
    if (lstatSync(current).isSymbolicLink()) throw new Error("server_restore_target_invalid");
    if (current === target && !lstatSync(current).isFile()) throw new Error("server_restore_target_invalid");
  }
  mkdirSync(emergency, { recursive: false });
  const moved = [];
  try {
    for (const current of currentPaths) {
      const destination = join(emergency, basename(current));
      renameSync(current, destination);
      moved.push({ from: current, to: destination });
    }
  } catch (error) {
    for (const entry of moved.reverse()) {
      if (!existsSync(entry.from) && existsSync(entry.to)) {
        renameSync(entry.to, entry.from);
      }
    }
    rmSync(emergency, { recursive: true, force: true });
    throw error;
  }
  return emergency;
}

function restoreDatabaseFromEmergency(target, emergency) {
  if (!emergency || !existsSync(emergency)) return;
  for (const current of [target, ...databaseSidecarPaths(target)]) rmSync(current, { force: true });
  for (const entry of sortedDirectoryEntries(emergency)) {
    renameSync(join(emergency, entry.name), join(dirname(target), entry.name));
  }
  rmSync(emergency, { recursive: true, force: true });
}

function publishStagedDatabase(stage) {
  const { target, parent, tempTarget } = stage;
  let emergency = null;
  try {
    emergency = moveCurrentDatabaseToEmergency(target, parent);
    renameSync(tempTarget, target);
    return { restored: target, emergency_backup: emergency || null, quick_check: "ok" };
  } catch (error) {
    rmSync(tempTarget, { force: true });
    for (const sidecar of databaseSidecarPaths(tempTarget)) rmSync(sidecar, { force: true });
    restoreDatabaseFromEmergency(target, emergency);
    throw error;
  }
}

function effectiveTargetPath(path) {
  const resolved = resolve(path);
  if (existsSync(resolved)) return realpathSync(resolved);
  const parent = ensureDirectory(dirname(resolved));
  return join(parent, basename(resolved));
}

function assertTargetSeparateFromBackup(targetPath, backupRootPath, code = "server_restore_target_overlaps_backup_root") {
  const target = effectiveTargetPath(targetPath);
  const backup = ensureDirectory(backupRootPath);
  if (isInsidePath(backup, target) || isInsidePath(target, backup)) throw new Error(code);
  return target;
}

function assertAttachmentTargetSeparateFromDatabase(targetRootPath, dbPath = databasePath()) {
  const target = effectiveTargetPath(targetRootPath);
  const databaseTarget = effectiveTargetPath(dbPath);
  if (isInsidePath(target, databaseTarget)) throw new Error("server_restore_targets_must_be_separate");
}

function assertDatabaseTargetSeparateFromAttachments(targetDbPath, root = attachmentRoot()) {
  const target = effectiveTargetPath(targetDbPath);
  const attachments = effectiveTargetPath(root);
  if (isInsidePath(attachments, target)) throw new Error("server_restore_targets_must_be_separate");
}

export function restoreDatabaseBackup({ inputPath, targetDbPath = databasePath(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_DATABASE_CONFIRMATION && confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  const source = databaseBackupFile(inputPath, backupRoot);
  assertTargetSeparateFromBackup(targetDbPath, backupRoot);
  assertDatabaseTargetSeparateFromAttachments(targetDbPath);
  verifySqliteDatabase(source);
  verifyKnownSqliteMigrations(source);
  return publishStagedDatabase(stageDatabaseRestore(source, targetDbPath));
}

export function isFilesystemRootPath(path) {
  if (/^[a-zA-Z]:[\\/]?$/.test(String(path || ""))) return true;
  const resolved = resolve(path);
  return dirname(resolved) === resolved;
}

function isMountPoint(path) {
  if (isFilesystemRootPath(path)) return true;
  if (!existsSync(path)) return false;
  const parentPath = dirname(path);
  if (process.platform === "win32") return false;
  const current = statSync(path);
  const parent = statSync(parentPath);
  return current.dev !== parent.dev || current.ino === parent.ino;
}

function stageAttachmentRestore(sourceSet, targetRoot) {
  const attachmentsSource = join(sourceSet, ATTACHMENTS_DIR);
  const manifest = verifyAttachmentBackup(sourceSet);
  const target = resolve(targetRoot);
  const parent = ensureDirectory(dirname(target));
  if (isMountPoint(target)) throw new Error("server_restore_target_must_be_child_directory");
  const tempTarget = join(parent, `.${basename(target)}.restore-${randomUUID()}.tmp`);
  assertInside(parent, tempTarget);
  mkdirSync(tempTarget, { recursive: false, mode: 0o700 });
  chmodSync(tempTarget, 0o700);
  try {
    for (const file of manifest.files) {
      const parts = normalizeManifestRelativePath(file.relative_path);
      const sourcePath = assertInside(attachmentsSource, join(attachmentsSource, ...parts), "server_backup_attachment_path_invalid");
      assertNoSymlinkPath(attachmentsSource, sourcePath, "server_backup_attachment_symlink");
      if (!isInsidePath(realpathSync(attachmentsSource), realpathSync(sourcePath))) throw new Error("server_backup_attachment_symlink");
      const destinationPath = assertInside(tempTarget, join(tempTarget, ...parts), "server_backup_attachment_path_invalid");
      ensureParent(destinationPath);
      copyPrivateFile(sourcePath, destinationPath);
    }
    let totalBytes = 0;
    for (const file of manifest.files) {
      const destinationPath = assertInside(tempTarget, join(tempTarget, ...normalizeManifestRelativePath(file.relative_path)), "server_backup_attachment_path_invalid");
      if (sha256File(destinationPath) !== file.sha256) throw new Error("server_backup_attachment_checksum_mismatch");
      totalBytes += statSync(destinationPath).size;
    }
    if (totalBytes !== Number(manifest.total_bytes)) throw new Error("server_backup_attachment_manifest_invalid");
    return { target, parent, tempTarget };
  } catch (error) {
    rmSync(tempTarget, { recursive: true, force: true });
    throw error;
  }
}

function publishStagedAttachments(stage) {
  const { target, parent, tempTarget } = stage;
  const emergency = join(parent, `${basename(target)}.pre-restore-${restoreSuffix()}`);
  let movedCurrent = false;
  try {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("server_restore_target_invalid");
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

export function restoreAttachmentsBackup({ inputPath, targetRoot = attachmentRoot(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_ATTACHMENTS_CONFIRMATION && confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  const sourceSet = attachmentBackupSet(inputPath, backupRoot);
  assertTargetSeparateFromBackup(targetRoot, backupRoot);
  assertAttachmentTargetSeparateFromDatabase(targetRoot);
  return publishStagedAttachments(stageAttachmentRestore(sourceSet, targetRoot));
}

function validateCombinedRestoreTargets(targetDbPath, targetRoot, backupRoot) {
  const databaseTarget = effectiveTargetPath(targetDbPath || databasePath());
  const attachmentTarget = effectiveTargetPath(targetRoot || attachmentRoot());
  if (isInsidePath(attachmentTarget, databaseTarget)) {
    throw new Error("server_restore_targets_must_be_separate");
  }
  assertTargetSeparateFromBackup(databaseTarget, backupRoot);
  assertTargetSeparateFromBackup(attachmentTarget, backupRoot);
}

export function restoreServerBackup({ inputPath, targetDbPath = databasePath(), targetRoot = attachmentRoot(), backupRoot = serverBackupRoot(), confirmation } = {}) {
  if (confirmation !== RESTORE_SERVER_CONFIRMATION) throw new Error("server_restore_confirmation_required");
  validateCombinedRestoreTargets(targetDbPath, targetRoot, backupRoot);
  const sourceSet = attachmentBackupSet(inputPath, backupRoot);
  readBackupMetadata(sourceSet, ["full"]);
  const databaseSource = databaseBackupFile(sourceSet, backupRoot);
  verifySqliteDatabase(databaseSource);
  verifyKnownSqliteMigrations(databaseSource);
  const attachmentManifest = verifyAttachmentBackup(sourceSet);
  verifyDatabaseAttachmentCoherence(databaseSource, attachmentManifest);
  const databaseStage = stageDatabaseRestore(databaseSource, targetDbPath);
  let attachmentStage;
  try {
    attachmentStage = stageAttachmentRestore(sourceSet, targetRoot);
  } catch (error) {
    rmSync(databaseStage.tempTarget, { force: true });
    for (const sidecar of databaseSidecarPaths(databaseStage.tempTarget)) rmSync(sidecar, { force: true });
    throw error;
  }
  let database;
  try {
    database = publishStagedDatabase(databaseStage);
    const attachments = publishStagedAttachments(attachmentStage);
    return { database, attachments };
  } catch (error) {
    if (database?.emergency_backup) {
      restoreDatabaseFromEmergency(database.restored, database.emergency_backup);
    } else if (database?.restored) {
      for (const current of [database.restored, ...databaseSidecarPaths(database.restored)]) rmSync(current, { force: true });
    }
    rmSync(databaseStage.tempTarget, { force: true });
    rmSync(attachmentStage.tempTarget, { recursive: true, force: true });
    throw error;
  }
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
