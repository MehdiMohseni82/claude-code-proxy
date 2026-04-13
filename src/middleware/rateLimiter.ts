import type { Request, Response, NextFunction } from "express";

// Default limits when the key has NULL (no custom value set)
const DEFAULT_RPM = 30;

// In-memory sliding window for rate limiting.
// Each key tracks an array of request timestamps and token counts.
interface KeyWindow {
  requestTimestamps: number[];
  tokenEntries: { ts: number; tokens: number }[];
}

const windows = new Map<number, KeyWindow>();
let checkCount = 0;

function getWindow(keyId: number): KeyWindow {
  let w = windows.get(keyId);
  if (!w) {
    w = { requestTimestamps: [], tokenEntries: [] };
    windows.set(keyId, w);
  }
  return w;
}

function cleanOldEntries(w: KeyWindow, now: number): void {
  const cutoff = now - 60_000; // 60-second window
  // Remove timestamps older than the window
  while (w.requestTimestamps.length > 0 && w.requestTimestamps[0] < cutoff) {
    w.requestTimestamps.shift();
  }
  while (w.tokenEntries.length > 0 && w.tokenEntries[0].ts < cutoff) {
    w.tokenEntries.shift();
  }
}

// Periodic cleanup of all windows to prevent memory leaks from deleted/unused keys
function maybeGlobalCleanup(): void {
  checkCount++;
  if (checkCount % 100 !== 0) return;
  const now = Date.now();
  for (const [keyId, w] of windows) {
    cleanOldEntries(w, now);
    if (w.requestTimestamps.length === 0 && w.tokenEntries.length === 0) {
      windows.delete(keyId);
    }
  }
}

function isAnthropicRoute(req: Request): boolean {
  const p = req.path;
  return p === "/messages" || p.startsWith("/messages/");
}

function sendRateLimitError(req: Request, res: Response, message: string, retryAfter: number): void {
  res.setHeader("Retry-After", String(retryAfter));
  if (isAnthropicRoute(req)) {
    res.status(429).json({
      type: "error",
      error: { type: "rate_limit_error", message },
    });
  } else {
    res.status(429).json({
      error: { message, type: "rate_limit_error" },
    });
  }
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const keyId = req.apiKeyId;
  if (!keyId) {
    // No key attached (auth disabled or no keys) — skip
    next();
    return;
  }

  maybeGlobalCleanup();

  const now = Date.now();
  const w = getWindow(keyId);
  cleanOldEntries(w, now);

  // Check RPM
  const rpmLimit = req.rateLimitRpm ?? DEFAULT_RPM;
  if (rpmLimit > 0 && w.requestTimestamps.length >= rpmLimit) {
    const oldestInWindow = w.requestTimestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + 60_000 - now) / 1000);
    sendRateLimitError(
      req, res,
      `Rate limit exceeded: ${rpmLimit} requests per minute. Try again in ${retryAfter}s.`,
      Math.max(1, retryAfter)
    );
    return;
  }

  // Check TPM (if configured)
  const tpmLimit = req.rateLimitTpm;
  if (tpmLimit != null && tpmLimit > 0) {
    const currentTokens = w.tokenEntries.reduce((sum, e) => sum + e.tokens, 0);
    if (currentTokens >= tpmLimit) {
      const oldestInWindow = w.tokenEntries[0]?.ts ?? now;
      const retryAfter = Math.ceil((oldestInWindow + 60_000 - now) / 1000);
      sendRateLimitError(
        req, res,
        `Token rate limit exceeded: ${tpmLimit} tokens per minute. Try again in ${retryAfter}s.`,
        Math.max(1, retryAfter)
      );
      return;
    }
  }

  // Record this request's timestamp
  w.requestTimestamps.push(now);
  next();
}

/**
 * Record token usage for TPM tracking. Called from sdkBridge after the
 * response completes, so the actual token count is known.
 */
export function recordTokensForRateLimit(keyId: number, tokens: number): void {
  if (!keyId || tokens <= 0) return;
  const w = getWindow(keyId);
  w.tokenEntries.push({ ts: Date.now(), tokens });
}
