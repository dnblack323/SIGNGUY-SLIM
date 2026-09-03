import { openDatabase, runMigrations } from "./db.js";
import { isProductionRuntime, validateProductionConfig } from "./config.js";
import { migrateProductionDatabase } from "./serverBackup.js";

if (isProductionRuntime()) {
  const initialize = process.argv.includes("--initialize") || process.env.SIGNGUY_SLIM_INITIALIZE_PRODUCTION === "1";
  validateProductionConfig({
    requireExistingAttachmentRoot: true,
    requireExistingBackupRoot: true,
  });
  migrateProductionDatabase({ initialize });
} else {
  validateProductionConfig();
  const db = openDatabase();
  runMigrations(db);
  db.close();
}
console.log("Slim database migrations applied.");
