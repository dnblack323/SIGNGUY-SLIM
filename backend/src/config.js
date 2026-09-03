import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === undefined || value === "") return DEFAULT_SERVER_BACKUP_RETAIN_LAST;
  const parsed = Number(value);
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

function decodeMountInfoPath(value) {
  return String(value || "").replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)));
}

function mountInfoMountPoints(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const preSeparator = line.split(" - ")[0]?.trim();
      if (!preSeparator) return null;
      const fields = preSeparator.split(/\s+/);
      if (fields.length < 5) return null;
      return decodeMountInfoPath(fields[4]);
    })
    .filter(Boolean);
}

export function mountInfoHasMountPoint(text, path, resolvePath = realpathSync) {
  const target = resolvePath(path);
  for (const mountPoint of mountInfoMountPoints(text)) {
    try {
      if (resolvePath(mountPoint) === target) return true;
    } catch {
      if (resolve(mountPoint) === resolve(path)) return true;
    }
  }
  return false;
}

function isListedLinuxMountPoint(path) {
  if (process.platform !== "linux" || !existsSync("/proc/self/mountinfo") || !existsSync(path)) return false;
  return mountInfoHasMountPoint(readFileSync("/proc/self/mountinfo", "utf8"), path);
}

function isMountPoint(path) {
  if (isFilesystemRootPath(path)) return true;
  if (!existsSync(path)) return false;
  if (isListedLinuxMountPoint(path)) return true;
  if (process.platform === "win32") return false;
  const current = statSync(path);
  const parent = statSync(dirname(path));
  return current.dev !== parent.dev || current.ino === parent.ino;
}

function rejectDirectoryRuntimeRoot(name, value) {
  if (isMountPoint(value)) throw new Error(`production_${pathName(name)}_must_be_child_directory`);
}

function rejectStorageOverlap(config) {
  for (const sidecar of databaseSidecarPaths(config.dbPath)) {
    if (
      isInsidePath(sidecar, config.attachmentRoot) ||
      isInsidePath(config.attachmentRoot, sidecar) ||
      isInsidePath(sidecar, config.serverBackupRoot) ||
      isInsidePath(config.serverBackupRoot, sidecar)
    ) {
      throw new Error("production_storage_paths_must_be_distinct");
    }
  }
  if (
    isInsidePath(config.attachmentRoot, config.serverBackupRoot) ||
    isInsidePath(config.serverBackupRoot, config.attachmentRoot) ||
    pathsOverlapThroughFilesystemAliases(config.attachmentRoot, config.serverBackupRoot)
  ) {
    throw new Error("production_attachment_and_backup_roots_must_be_separate");
  }
  if (sameFilesystemEntry(config.attachmentRoot, config.serverBackupRoot)) {
    throw new Error("production_attachment_and_backup_roots_must_be_separate");
  }
  assertNoFilesystemAliasAncestor(config.serverBackupRoot, config.attachmentRoot, "production_attachment_and_backup_roots_must_be_separate");
  assertNoFilesystemAliasAncestor(config.attachmentRoot, config.serverBackupRoot, "production_attachment_and_backup_roots_must_be_separate");
  if (
    isInsidePath(config.attachmentRoot, config.dbPath) ||
    isInsidePath(config.serverBackupRoot, config.dbPath) ||
    isInsidePath(config.dbPath, config.attachmentRoot) ||
    isInsidePath(config.dbPath, config.serverBackupRoot) ||
    pathsOverlapThroughFilesystemAliases(config.attachmentRoot, config.dbPath) ||
    pathsOverlapThroughFilesystemAliases(config.serverBackupRoot, config.dbPath)
  ) {
    throw new Error("production_storage_paths_must_be_distinct");
  }
  assertNoFilesystemAliasAncestor(config.dbPath, config.attachmentRoot, "production_storage_paths_must_be_distinct");
  assertNoFilesystemAliasAncestor(config.dbPath, config.serverBackupRoot, "production_storage_paths_must_be_distinct");
  assertNoFilesystemAliasAncestor(config.attachmentRoot, config.dbPath, "production_storage_paths_must_be_distinct");
  assertNoFilesystemAliasAncestor(config.serverBackupRoot, config.dbPath, "production_storage_paths_must_be_distinct");
}

function sameFilesystemEntry(left, right) {
  try {
    const leftStat = statSync(left);
    const rightStat = statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
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

function existingPathAncestors(path) {
  const ancestors = [];
  let current = resolve(path);
  while (true) {
    if (pathExistsOrDanglingSymlink(current)) ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return ancestors;
}

function samePath(left, right) {
  return isInsidePath(left, right) && isInsidePath(right, left);
}

function effectiveExistingAncestorPath(path) {
  const requested = resolve(path);
  for (const ancestor of existingPathAncestors(requested)) {
    try {
      const suffix = relative(ancestor, requested);
      return resolve(realpathSync(ancestor), suffix);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return requested;
}

function pathsOverlapThroughFilesystemAliases(left, right) {
  const effectiveLeft = effectiveExistingAncestorPath(left);
  const effectiveRight = effectiveExistingAncestorPath(right);
  return isInsidePath(effectiveLeft, effectiveRight) || isInsidePath(effectiveRight, effectiveLeft);
}

function assertNoFilesystemAliasAncestor(candidatePath, referencePath, code) {
  if (!existsSync(referencePath)) return;
  const reference = realpathSync(referencePath);
  for (const ancestor of existingPathAncestors(candidatePath)) {
    if (samePath(ancestor, reference)) continue;
    if (sameFilesystemEntry(ancestor, reference)) throw new Error(code);
  }
}

function databaseSidecarPaths(path) {
  return [`${path}-wal`, `${path}-shm`, `${path}-journal`];
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
    if (isMountPoint(path)) throw new Error("production_db_path_must_not_be_mount_file");
  } catch (error) {
    if (["production_db_path_must_be_file_backed", "production_db_path_must_not_be_mount_file"].includes(error.message)) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertDatabaseWritable(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile()) return;
  let fd;
  try {
    fd = openSync(path, "r+");
  } catch (error) {
    throw new Error("production_db_path_must_be_writable", { cause: error });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  chmodSync(path, 0o600);
}

function assertPrivateDirectoryMode(path, code) {
  if (process.platform === "win32") return;
  if ((lstatSync(path).mode & 0o777) !== 0o700) throw new Error(code);
}

function ensureWritableDirectory(path, code, mode, { chmodExisting = true, requirePrivateExisting = false } = {}) {
  const existed = existsSync(path);
  mkdirSync(path, { recursive: true, mode });
  assertNotSymlink(path, code);
  const real = realpathSync(path);
  if (mode !== undefined && (!existed || chmodExisting)) chmodSync(real, mode);
  if (mode !== undefined && existed && requirePrivateExisting) assertPrivateDirectoryMode(real, "production_db_directory_must_be_private");
  const probe = join(real, `.signguy-slim-write-test-${randomUUID()}`);
  writeFileSync(probe, "ok", mode === undefined ? { flag: "wx" } : { flag: "wx", mode });
  unlinkSync(probe);
  return real;
}

function assertWritableExistingDirectory(path, missingCode, symlinkCode, mode, { chmodExisting = true, requirePrivateExisting = false } = {}) {
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
  if (mode !== undefined && chmodExisting) chmodSync(real, mode);
  if (mode !== undefined && requirePrivateExisting) assertPrivateDirectoryMode(real, "production_db_directory_must_be_private");
  const probe = join(real, `.signguy-slim-write-test-${randomUUID()}`);
  writeFileSync(probe, "ok", mode === undefined ? { flag: "wx" } : { flag: "wx", mode });
  unlinkSync(probe);
  return real;
}

export function validateProductionConfig({
  env = process.env,
  production = isProductionRuntime(env),
  checkWritable = true,
  requireExistingDatabaseDirectory = false,
  requireExistingAttachmentRoot = false,
  requireExistingBackupRoot = false,
} = {}) {
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
    const realDbDirectory = requireExistingDatabaseDirectory
      ? assertWritableExistingDirectory(dirname(config.dbPath), "production_db_directory_missing", "production_db_directory_symlink", 0o700, {
        chmodExisting: false,
        requirePrivateExisting: true,
      })
      : ensureWritableDirectory(dirname(config.dbPath), "production_db_directory_symlink", 0o700, {
        chmodExisting: false,
        requirePrivateExisting: true,
      });
    config.dbPath = join(realDbDirectory, basename(config.dbPath));
    config.attachmentRoot = requireExistingAttachmentRoot
      ? assertWritableExistingDirectory(config.attachmentRoot, "production_attachment_root_missing", "production_attachment_root_symlink", 0o700)
      : ensureWritableDirectory(config.attachmentRoot, "production_attachment_root_symlink", 0o700);
    config.serverBackupRoot = requireExistingBackupRoot
      ? assertWritableExistingDirectory(config.serverBackupRoot, "production_server_backup_root_missing", "production_server_backup_root_symlink", 0o700)
      : ensureWritableDirectory(config.serverBackupRoot, "production_server_backup_root_symlink", 0o700);
    assertDatabaseFileTarget(config.dbPath);
    assertDatabaseWritable(config.dbPath);
    rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot);
    rejectDirectoryRuntimeRoot("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot);
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_DB_PATH", config.dbPath);
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_ATTACHMENT_ROOT", config.attachmentRoot, { directory: true });
    rejectRepositoryRuntimePath("SIGNGUY_SLIM_SERVER_BACKUP_ROOT", config.serverBackupRoot, { directory: true });
    rejectStorageOverlap(config);
  }

  return config;
}
