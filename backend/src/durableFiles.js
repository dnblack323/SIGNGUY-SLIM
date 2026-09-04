import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

export function durableWriteFile(path, data, options = {}) {
  writeFileSync(path, data, options);
  if (options.mode !== undefined) chmodSync(path, options.mode);
  syncFilePath(path);
  trySyncDirectory(dirname(path));
}

export function durableCopyFile(source, destination, { mode = 0o600 } = {}) {
  copyFileSync(source, destination);
  chmodSync(destination, mode);
  syncFilePath(destination);
  trySyncDirectory(dirname(destination));
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
