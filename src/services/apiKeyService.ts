import { randomBytes, createHash } from "crypto";
import { db } from "../db/connection.js";
import type { ApiKey, ApiKeyPublic, ApiKeyCreateResult } from "../types/index.js";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function toPublic(row: ApiKey): ApiKeyPublic {
  let allowedModels: string[] | null = null;
  if (row.allowed_models) {
    try { allowedModels = JSON.parse(row.allowed_models); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    is_revoked: row.is_revoked === 1,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
    allow_builtin_tools: row.allow_builtin_tools === 1,
    rate_limit_rpm: row.rate_limit_rpm,
    rate_limit_tpm: row.rate_limit_tpm,
    monthly_budget_usd: row.monthly_budget_usd,
    allowed_models: allowedModels,
    system_prompt: row.system_prompt,
    cache_ttl_seconds: row.cache_ttl_seconds,
  };
}

export function createApiKey(name: string): ApiKeyCreateResult {
  const raw = `sk-${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(raw);
  const keyPrefix = raw.slice(0, 11); // "sk-" + first 8 hex chars

  const stmt = db.prepare(
    "INSERT INTO api_keys (name, key_hash, key_prefix) VALUES (?, ?, ?)"
  );
  const result = stmt.run(name, keyHash, keyPrefix);

  return {
    id: result.lastInsertRowid as number,
    name,
    key: raw,
    key_prefix: keyPrefix,
    created_at: new Date().toISOString(),
  };
}

export function listApiKeys(): ApiKeyPublic[] {
  const rows = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as ApiKey[];
  return rows.map(toPublic);
}

export function revokeApiKey(id: number): boolean {
  const result = db.prepare(
    "UPDATE api_keys SET is_revoked = 1, revoked_at = datetime('now') WHERE id = ? AND is_revoked = 0"
  ).run(id);
  return result.changes > 0;
}

export function validateApiKey(raw: string): ApiKey | null {
  const keyHash = hashKey(raw);
  const row = db.prepare(
    "SELECT * FROM api_keys WHERE key_hash = ? AND is_revoked = 0"
  ).get(keyHash) as ApiKey | undefined;

  if (row) {
    // Update last_used_at
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  }

  return row ?? null;
}

export function updateApiKeyBuiltinTools(id: number, allow: boolean): boolean {
  const result = db.prepare(
    "UPDATE api_keys SET allow_builtin_tools = ? WHERE id = ?"
  ).run(allow ? 1 : 0, id);
  return result.changes > 0;
}

// Whitelist of columns that can be updated via the generic updater
const UPDATABLE_COLUMNS = new Set([
  "allow_builtin_tools",
  "rate_limit_rpm",
  "rate_limit_tpm",
  "monthly_budget_usd",
  "allowed_models",
  "system_prompt",
  "cache_ttl_seconds",
]);

export function updateApiKey(id: number, fields: Record<string, unknown>): boolean {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (!UPDATABLE_COLUMNS.has(key)) continue;
    setClauses.push(`${key} = ?`);
    values.push(value ?? null);
  }

  if (setClauses.length === 0) return false;

  values.push(id);
  const result = db.prepare(
    `UPDATE api_keys SET ${setClauses.join(", ")} WHERE id = ?`
  ).run(...values);
  return result.changes > 0;
}

export function hasAnyKeys(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM api_keys").get() as { count: number };
  return row.count > 0;
}
