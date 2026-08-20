import { openDatabase, runMigrations } from "./db.js";

const db = openDatabase();
runMigrations(db);
db.close();
console.log("Slim database migrations applied.");
