import { chmodSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_DB = join(ROOT, "data", "signguy-slim.sqlite");
export const DEFAULT_ATTACHMENT_ROOT = join(process.cwd(), "data", "attachments");
export const DEFAULT_SERVER_BACKUP_ROOT = join(process.cwd(), "data", "server-backups");
export const DEFAULT_SERVER_BACKUP_RETAIN_LAST = 30;

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === "production";
}

export function databasePath(env = process.env) {
  return env.SIGNGUY_SLIM_DB_PATH || DEFAULT_DB;
}

export function attachmentRoot(env = process.env) {
  return resolve(env.SIGNGUY_SLIM_ATTACHMENT_ROOT || DEFAULT_ATTACHMENT_ROOT);
}

export function serverBackupRoot(env = process.env) {
  return resolve(env.SIGNGUY_SLIM_SERVER_BACKUP_ROOT || DEFAULT_SERVER_BACKUP_ROOT);
}

export function serverBackupRetainLast(env = process.env) {
  const raw = env.SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST;
  if (raw === undefined || raw === "") return DEFAULT_SERVER_BACKUP_RETAIN_LAST;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) throw new Error("server_backup_retain_last_invalid");
  return parsed;
}

function pathName(label) {
  return label.replace(/^SIGNGUY_SLIM_/, "").toLowerCase();
}

export function isInsidePath(root, candidate) {
  const normalize = (value) => {
    const resolved = resolve(value).replace(/[\\/]+$/, "") || sep;
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function requireConfiguredPath(env, name) {
  const value = env[name];
  if (!value || !String(value).trim()) throw new Error(`production_${pathName(name)}_required`);
  if (!isAbsolute(value)) throw new Error(`production_${pathName(name)}_must_be_absolute`);
  return resolve(value);
}

function rejectRepositoryRuntimePath(name, value, { directory = false } = {}) {
  if (isInsidePath(ROOT, value) || (directory && isInsidePath(value, ROOT))) {
    throw new Error(`production_${pathName(name)}_must_be_outside_repository`);
  }
}

function isFilesystemRootPath(path) {
  if (/^[a-zA-Z]:[\\/]?$/.test(String(path || ""))) return true;
  const resolved = resolve(path);
  return dirname(resolved) === resolved;
}

function rejectDirectoryRuntimeRoot(name, value) {
  if (isFilesystemRootPath(value)) throw new Error(`production_${pathName(name)}_must_be_child_directory`);
}

function rejectStorageOverlap(config) {
  if (isInsidePath(config.attachmentRoot, config.serverBackupRoot) || isInsidePath(config.serverBackupRoot, config.attachmentRoot)) {
    throw new Error("production_attachment_and_backup_roots_must_be_separate");
  }
  if (
    isInsidePath(config.attachmentRoot, config.dbPath) ||
    isInsidePath(config.serverBackupRoot, config.dbPath) ||
    isInsidePath(config.dbPath, config.attachmentRoot) ||
    isInsidePath(config.dbPath, config.serverBackupRoot)
  ) {
    throw new Error("production_storage_paths_must_be_distinct");
  }
}

function assertNotSymlink(path, code) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(code);
  } catch (error) {
    if (error.message === code) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertDatabaseFileTarget(path) {
  try {
    if (!lstatSync(path).isFile()) throw new Error("production_db_path_must_be_file_backed");
  } catch (error) {
    if (error.message === "production_db_path_must_be_file_backed") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

function ensureWritableDirectory(path, code, mode) {
  mkdirSync(path, { recursive: true, mode });
  assertNotSymlink(path, code);
  const real = realpathSync(path);
  if (mode !== undefined) chmodSync(real, mode);
  const probe = join(real, `.signguy-slim-write-test-${randomUUID()}`);
  writeFileSync(probe, "ok", { flag: "wx" });
  unlinkSync(probe);
  return real;
}

function assertWritableExistingDirectory(path, missingCode, symlinkCode, mode) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(missingCode, { cause: error });
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(symlinkCode);
  if (!stat.isDirectory()) throw new Error(missingCode);
  const real = realpathSync(path);
  if (mode !== undefined) chmodSync(real, mode);
  const probe = join(real, `.signguy-slim-write-test-${randomUUID()}`);
  writeFileSync(probe, "ok", { flag: "wx" });
  unlinkSync(probe);
  return real;
}

export function validateProductionConfig({ env = process.env, production = isProductionRuntime(env), checkWritable = true, requireExistingAttachmentRoot = false } = {}) {
  const config = {
    production,
    dbPath: databasePath(env),
    attachmentRoot: attachmentRoot(env),
    serverBackupRoot: serverBackupRoot(env),
    serverBackupRetainLast: serverBackupRetainLast(env),
  };

  if (!production) return config;

  if (env.SIGNGUY_SLIM_DB_PATH === ":memory:") throw new Error("production_db_path_must_be_file_backed");
  config.dbPath = requireConfiguredPath(env, "SIGNGUY_SLIM_DB_PATH");
  config.attachmentRoot = requireConfiguredPath(env, "SIGNGUY_SLIM_ATTACHMENT_ROOT");
  config.serverBackupRoot = requireConfiguredPath(env, "SIGNGUY_SLIM_SERVER_BACKUP_ROOT");

  rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot);
  rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot);
  rejectRepositoryRuntimePath("SIGNGUY_SLIM_DB_PATH", config.dbPath);
  rejectRepositoryRuntimePath("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot, { directory: true });
  rejectRepositoryRuntimePath("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot, { directory: true });

  rejectStorageOverlap(config);

  if (checkWritable) {
    assertNotSymlink(config.dbPath, "production_db_path_symlink");
    assertDatabaseFileTarget(config.dbPath);
    const realDbDirectory = ensureWritableDirectory(dirname(config.dbPath), "production_db_directory_symlink");
    config.dbPath = join(realDbDirectory, basename(config.dbPath));
    config.attachmentRoot = requireExistingAttachmentRoot
      ? assertWritableExistingDirectory(config.attachmentRoot, "production_attachment_root_missing", "production_attachment_root_symlink")
      : ensureWritableDirectory(config.attachmentRoot, "production_attachment_root_symlink");
    config.serverBackupRoot = ensureWritableDirectory(config.serverBackupRoot, "production_server_backup_root_symlink", 0o700);
    assertDatabaseFileTarget(config.dbPath);
    rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot);
    rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot);
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_DB_PATH", config.dbPath);
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot, { directory: true });
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot, { directory: true });
    rejectStorageOverlap(config);
  }

  return config;
}
