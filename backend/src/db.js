import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, databasePath, isProductionRuntime } from "./config.js";

const MIGRATIONS_DIR = join(ROOT, "backend", "migrations");

export { databasePath };

export function configureDatabase(db, path = db.location?.(), { production = isProductionRuntime() } = {}) {
  if (path && path !== ":memory:") assertDatabaseRuntimeFilesUnlinked(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (path && path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`PRAGMA synchronous = ${production ? "FULL" : "NORMAL"}`);
    protectDatabaseFiles(path);
  }
  return db;
}

export function openDatabase(path = databasePath(), options = {}) {
  if (path !== ":memory:") {
    const dbDirectory = dirname(path);
    const directoryExisted = existsSync(dbDirectory);
    mkdirSync(dbDirectory, { recursive: true, mode: 0o700 });
    if (!directoryExisted) chmodSync(dbDirectory, 0o700);
    assertDatabaseRuntimeFilesUnlinked(path);
  }
  const db = new DatabaseSync(path);
  return configureDatabase(db, path, options);
}

function databaseRuntimePaths(path) {
  return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`];
}

function assertDatabaseRuntimeFilesUnlinked(path) {
  for (const candidate of databaseRuntimePaths(path)) {
    let stats;
    try {
      stats = lstatSync(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile()) throw new Error("database_runtime_file_invalid");
    if (stats.nlink > 1) throw new Error("database_runtime_file_must_not_be_hard_linked");
  }
}

function protectDatabaseFiles(path) {
  for (const candidate of databaseRuntimePaths(path)) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
}

function upSql(text) {
  return text.split("-- migrate:down")[0].replace("-- migrate:up", "").trim();
}

export function pendingMigrationIds(db) {
  const files = migrationFiles();
  const known = new Set(files);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return files;
  const seenRows = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
  const unknown = seenRows.filter((id) => !known.has(id));
  if (unknown.length) {
    const error = new Error("database_schema_has_unknown_migrations");
    error.unknown_migrations = unknown;
    throw error;
  }
  const seen = new Set(seenRows);
  return files.filter((file) => !seen.has(file));
}

export function runMigrations(db) {
  const files = migrationFiles();
  const known = new Set(files);
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const seenRows = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
  const unknown = seenRows.filter((id) => !known.has(id));
  if (unknown.length) {
    const error = new Error("database_schema_has_unknown_migrations");
    error.unknown_migrations = unknown;
    throw error;
  }
  const seen = new Set(seenRows);
  for (const file of files) {
    if (seen.has(file)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(upSql(readFileSync(join(MIGRATIONS_DIR, file), "utf8")));
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function migratedMemoryDatabase() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}
