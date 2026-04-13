import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      key_hash      TEXT NOT NULL UNIQUE,
      key_prefix    TEXT NOT NULL,
      is_revoked    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at    TEXT,
      last_used_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

    CREATE TABLE IF NOT EXISTS request_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id      INTEGER REFERENCES api_keys(id),
      completion_id   TEXT NOT NULL,
      requested_model TEXT NOT NULL,
      resolved_model  TEXT NOT NULL,
      is_stream       INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      total_cost_usd  REAL NOT NULL DEFAULT 0.0,
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',
      error_message   TEXT,
      prompt_preview  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_request_log_api_key ON request_log(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at);
  `);

  // Migration: add allow_builtin_tools column if it doesn't exist yet
  const keyCols = db
    .prepare("PRAGMA table_info(api_keys)")
    .all() as Array<{ name: string }>;
  if (!keyCols.some((c) => c.name === "allow_builtin_tools")) {
    db.exec(
      "ALTER TABLE api_keys ADD COLUMN allow_builtin_tools INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Migration: add full_prompt and full_response columns for request detail view
  const logCols = db
    .prepare("PRAGMA table_info(request_log)")
    .all() as Array<{ name: string }>;
  if (!logCols.some((c) => c.name === "full_prompt")) {
    db.exec("ALTER TABLE request_log ADD COLUMN full_prompt TEXT");
  }
  if (!logCols.some((c) => c.name === "full_response")) {
    db.exec("ALTER TABLE request_log ADD COLUMN full_response TEXT");
  }

  // Migration: per-key rate limits, budget, model restrictions, system prompt, cache TTL
  // Re-read keyCols in case it was already read above (allow_builtin_tools migration)
  const keyColsV2 = db
    .prepare("PRAGMA table_info(api_keys)")
    .all() as Array<{ name: string }>;
  const keyColNames = new Set(keyColsV2.map((c) => c.name));

  if (!keyColNames.has("rate_limit_rpm")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN rate_limit_rpm INTEGER DEFAULT NULL");
  }
  if (!keyColNames.has("rate_limit_tpm")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN rate_limit_tpm INTEGER DEFAULT NULL");
  }
  if (!keyColNames.has("monthly_budget_usd")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN monthly_budget_usd REAL DEFAULT NULL");
  }
  if (!keyColNames.has("allowed_models")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN allowed_models TEXT DEFAULT NULL");
  }
  if (!keyColNames.has("system_prompt")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN system_prompt TEXT DEFAULT NULL");
  }
  if (!keyColNames.has("cache_ttl_seconds")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN cache_ttl_seconds INTEGER DEFAULT NULL");
  }

  // Migration: settings table for server configuration (OAuth token, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
