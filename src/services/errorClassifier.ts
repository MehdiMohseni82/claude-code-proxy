// The Claude Code CLI reports every failure the same way: the SDK throws
// "Claude Code process exited with code 1" and the real reason arrives as
// assistant text (and sometimes on stderr). sdkBridge attaches that text to the
// error as `upstreamText`; this module turns it into an HTTP status so clients
// can tell a permanent failure from one worth retrying.

export interface ClassifiedError {
  status: number;
  type: string;
  message: string;
  /** Seconds until the stated reset, for the Retry-After header. */
  retryAfterSeconds?: number;
}

/** Error thrown by trackedQuery, carrying the CLI's own output. */
export interface UpstreamError extends Error {
  upstreamText?: string;
}

export function attachUpstreamText(err: unknown, text: string): void {
  if (err instanceof Error && text.trim()) {
    (err as UpstreamError).upstreamText = text.trim();
  }
}

/**
 * Seconds from `now` until a "resets 12:20pm (UTC)" style time, or undefined if
 * no such time is stated. Times without a zone are read as UTC, which is what
 * the CLI emits. A time that has already passed today is taken as tomorrow.
 */
export function parseResetSeconds(text: string, now: Date = new Date()): number | undefined {
  const m = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return undefined;

  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return undefined;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const reset = new Date(now);
  reset.setUTCHours(hour, minute, 0, 0);
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);

  return Math.ceil((reset.getTime() - now.getTime()) / 1000);
}

/**
 * Map an error from the SDK onto an HTTP status. Anything unrecognised stays a
 * 500, so a new upstream message is never silently treated as retryable.
 */
export function classifyUpstreamError(err: unknown, now: Date = new Date()): ClassifiedError {
  const base = err instanceof Error ? err.message : "Internal server error";
  const upstream = (err as UpstreamError | undefined)?.upstreamText ?? "";
  // The upstream text is the useful half; fall back to the SDK's exit message.
  const message = upstream || base;
  const haystack = `${base}\n${upstream}`;

  if (/out of (extra )?usage|usage limit|rate[ _-]?limit|too many requests|\b429\b/i.test(haystack)) {
    return {
      status: 429,
      type: "rate_limit_error",
      message,
      retryAfterSeconds: parseResetSeconds(haystack, now),
    };
  }

  if (/not_found_error|\bmodel not found\b|\b404\b/i.test(haystack)) {
    return { status: 404, type: "not_found_error", message };
  }

  if (/authentication_error|invalid api key|unauthorized|\b401\b|oauth token (has )?expired|please run .*login/i.test(haystack)) {
    return { status: 401, type: "authentication_error", message };
  }

  if (/permission_error|forbidden|\b403\b/i.test(haystack)) {
    return { status: 403, type: "permission_error", message };
  }

  if (/credit balance|billing/i.test(haystack)) {
    return { status: 402, type: "billing_error", message };
  }

  return { status: 500, type: "server_error", message };
}

/** Send a classified error as an OpenAI/Anthropic-shaped JSON body. */
export function sendClassifiedError(
  res: { status: (code: number) => unknown; setHeader: (k: string, v: string) => void; json: (b: unknown) => unknown },
  err: unknown
): void {
  const c = classifyUpstreamError(err);
  if (c.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(c.retryAfterSeconds));
  res.status(c.status);
  res.json({ error: { message: c.message, type: c.type } });
}
