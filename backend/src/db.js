import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = join(ROOT, "backend", "migrations");
const DEFAULT_DB = join(ROOT, "data", "signguy-slim.sqlite");

export function databasePath() {
  return process.env.SIGNGUY_SLIM_DB_PATH || DEFAULT_DB;
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function upSql(text) {
  return text.split("-- migrate:down")[0].replace("-- migrate:up", "").trim();
}

export function runMigrations(db) {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
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
