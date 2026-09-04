import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const IGNORED_SYNC_ERROR_CODES = new Set(["EACCES", "EINVAL", "EISDIR", "EPERM", "ENOTSUP"]);

export function syncFilePath(path) {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } catch (error) {
    if (!IGNORED_SYNC_ERROR_CODES.has(error?.code)) throw error;
  } finally {
    closeSync(fd);
  }
}

export function trySyncDirectory(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    if (!IGNORED_SYNC_ERROR_CODES.has(error?.code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function durableEnsureDirectory(path, { mode = 0o700 } = {}) {
  const target = resolve(path);
  const missing = [];
  let current = target;
  while (!existsSync(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (existsSync(current) && !lstatSync(current).isDirectory()) throw new Error("durable_directory_invalid");
  for (const directory of missing.reverse()) {
    try {
      mkdirSync(directory, { recursive: false, mode });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!lstatSync(directory).isDirectory()) throw new Error("durable_directory_invalid", { cause: error });
    }
    chmodSync(directory, mode);
    trySyncDirectory(dirname(directory));
    trySyncDirectory(directory);
  }
  return target;
}

export function durableWriteFile(path, data, options = {}) {
  const existed = existsSync(path);
  let wrote = false;
  try {
    writeFileSync(path, data, options);
    wrote = true;
    if (options.mode !== undefined) chmodSync(path, options.mode);
    syncFilePath(path);
    trySyncDirectory(dirname(path));
  } catch (error) {
    if (wrote && !existed) {
      try {
        rmSync(path, { force: true });
        trySyncDirectory(dirname(path));
      } catch {
        // Preserve the original durable-write failure.
      }
    }
    throw error;
  }
}

export function durableCopyFile(source, destination, { mode = 0o600 } = {}) {
  const existed = existsSync(destination);
  let copied = false;
  try {
    copyFileSync(source, destination);
    copied = true;
    chmodSync(destination, mode);
    syncFilePath(destination);
    trySyncDirectory(dirname(destination));
  } catch (error) {
    if (copied && !existed) {
      try {
        rmSync(destination, { force: true });
        trySyncDirectory(dirname(destination));
      } catch {
        // Preserve the original durable-copy failure.
      }
    }
    throw error;
  }
}

export function durablePublishFile(source, destination, { mode = 0o600 } = {}) {
  const directory = dirname(destination);
  const tempPath = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    copyFileSync(source, tempPath);
    chmodSync(tempPath, mode);
    syncFilePath(tempPath);
    renameSync(tempPath, destination);
    chmodSync(destination, mode);
    syncFilePath(destination);
    trySyncDirectory(directory);
    rmSync(source, { force: true });
  } catch (error) {
    try {
      if (existsSync(tempPath)) rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original durable publication failure.
    }
    throw error;
  }
}

export function durableReplaceFile(path, data, { mode = 0o600 } = {}) {
  const directory = dirname(path);
  const tempPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    durableWriteFile(tempPath, data, { flag: "wx", mode });
    renameSync(tempPath, path);
    chmodSync(path, mode);
    syncFilePath(path);
    trySyncDirectory(directory);
  } catch (error) {
    try {
      if (existsSync(tempPath)) rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original durable-write failure.
    }
    throw error;
  }
}
