import { db } from "../db/connection.js";

// In-memory cache to avoid DB reads on every SDK query
let cachedToken: string | null = null;
let cacheLoaded = false;

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value);

  // Invalidate cache when token changes
  if (key === "claude_oauth_token") {
    cachedToken = value;
    cacheLoaded = true;
  }
}

export function deleteSetting(key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  if (key === "claude_oauth_token") {
    cachedToken = null;
    cacheLoaded = true;
  }
}

/**
 * Get the OAuth token to use for SDK queries.
 * Priority: database setting > CLAUDE_CODE_OAUTH_TOKEN env var > ANTHROPIC_API_KEY env var
 */
export function getOAuthToken(): string | null {
  if (!cacheLoaded) {
    cachedToken = getSetting("claude_oauth_token");
    cacheLoaded = true;
  }
  return cachedToken || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
}

/**
 * Get token status info for admin display (never expose the full token).
 */
export function getTokenStatus(): { configured: boolean; source: string; preview: string | null } {
  const dbToken = getSetting("claude_oauth_token");
  if (dbToken) {
    return {
      configured: true,
      source: "database",
      preview: dbToken.slice(0, 15) + "..." + dbToken.slice(-4),
    };
  }

  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (envToken) {
    return {
      configured: true,
      source: "environment",
      preview: envToken.slice(0, 15) + "..." + envToken.slice(-4),
    };
  }

  return { configured: false, source: "none", preview: null };
}
