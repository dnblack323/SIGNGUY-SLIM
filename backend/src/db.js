import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, databasePath } from "./config.js";

const MIGRATIONS_DIR = join(ROOT, "backend", "migrations");

export { databasePath };

export function configureDatabase(db, path = db.location?.()) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (path && path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  return db;
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  return configureDatabase(db, path);
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
}

function upSql(text) {
  return text.split("-- migrate:down")[0].replace("-- migrate:up", "").trim();
}

export function pendingMigrationIds(db) {
  const files = migrationFiles();
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return files;
  const seen = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id));
  return files.filter((file) => !seen.has(file));
}

export function runMigrations(db) {
  const files = migrationFiles();
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const seen = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id));
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
