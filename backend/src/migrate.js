import { openDatabase, runMigrations } from "./db.js";
import { validateProductionConfig } from "./config.js";

validateProductionConfig();
const db = openDatabase();
runMigrations(db);
db.close();
console.log("Slim database migrations applied.");
