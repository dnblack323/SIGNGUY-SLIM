import { openDatabase, runMigrations } from "./db.js";
import { isProductionRuntime, validateProductionConfig } from "./config.js";
import { migrateProductionDatabase } from "./serverBackup.js";

if (isProductionRuntime()) {
  validateProductionConfig();
  migrateProductionDatabase();
} else {
  validateProductionConfig();
  const db = openDatabase();
  runMigrations(db);
  db.close();
}
console.log("Slim database migrations applied.");
