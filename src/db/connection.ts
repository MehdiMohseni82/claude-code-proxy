import Database, { type Database as DatabaseType } from "better-sqlite3";
import { DATABASE_PATH } from "../config.js";
import { runMigrations } from "./migrations.js";

const db: DatabaseType = new Database(DATABASE_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run migrations on startup
runMigrations(db);

export { db };
