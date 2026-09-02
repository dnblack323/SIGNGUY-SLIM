import { existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
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

function rejectStorageOverlap(config) {
  if (isInsidePath(config.attachmentRoot, config.serverBackupRoot) || isInsidePath(config.serverBackupRoot, config.attachmentRoot)) {
    throw new Error("production_attachment_and_backup_roots_must_be_separate");
  }
  if (isInsidePath(config.attachmentRoot, config.dbPath) || isInsidePath(config.serverBackupRoot, config.dbPath)) {
    throw new Error("production_storage_paths_must_be_distinct");
  }
}

function assertNotSymlink(path, code) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(code);
}

function ensureWritableDirectory(path, code) {
  mkdirSync(path, { recursive: true });
  assertNotSymlink(path, code);
  const real = realpathSync(path);
  const probe = join(real, `.signguy-slim-write-test-${randomUUID()}`);
  writeFileSync(probe, "ok", { flag: "wx" });
  unlinkSync(probe);
  return real;
}

export function validateProductionConfig({ env = process.env, production = isProductionRuntime(env), checkWritable = true } = {}) {
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

  rejectRepositoryRuntimePath("SIGNGUY_SLIM_DB_PATH", config.dbPath);
  rejectRepositoryRuntimePath("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot, { directory: true });
  rejectRepositoryRuntimePath("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot, { directory: true });

  rejectStorageOverlap(config);

  if (checkWritable) {
    assertNotSymlink(config.dbPath, "production_db_path_symlink");
    const realDbDirectory = ensureWritableDirectory(dirname(config.dbPath), "production_db_directory_symlink");
    config.dbPath = join(realDbDirectory, basename(config.dbPath));
    config.attachmentRoot = ensureWritableDirectory(config.attachmentRoot, "production_attachment_root_symlink");
    config.serverBackupRoot = ensureWritableDirectory(config.serverBackupRoot, "production_server_backup_root_symlink");
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_DB_PATH", config.dbPath);
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot, { directory: true });
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot, { directory: true });
    rejectStorageOverlap(config);
  }

  return config;
}
