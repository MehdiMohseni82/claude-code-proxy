import { mkdirSync } from "fs";
import { dirname } from "path";

export const PORT = parseInt(process.env.PORT || "3456");
export const DATABASE_PATH = process.env.DATABASE_PATH || "./data/proxy.db";
export const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || "";
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

// Ensure the database directory exists
mkdirSync(dirname(DATABASE_PATH), { recursive: true });
