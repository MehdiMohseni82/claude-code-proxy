// Smoke check for the upstream error classifier. Run: npx tsx scripts/check-error-classifier.ts
// Cases 1-3 are verbatim strings taken from the production request_log.
import { classifyUpstreamError, parseResetSeconds, attachUpstreamText } from "../src/services/errorClassifier.js";

const EXIT = "Claude Code process exited with code 1";
// Fixed clock: 2026-09-23 11:36:45 UTC, the timestamp of prod row 14244.
const NOW = new Date("2026-09-23T11:36:45Z");

function makeErr(upstream?: string): Error {
  const err = new Error(EXIT);
  if (upstream) attachUpstreamText(err, upstream);
  return err;
}

const cases: Array<{ name: string; upstream?: string; status: number; type: string; retryAfter?: number }> = [
  {
    name: "usage limit (prod row 14244)",
    upstream: "You're out of extra usage · resets 12:20pm (UTC)",
    status: 429,
    type: "rate_limit_error",
    retryAfter: 43 * 60 + 15, // 11:36:45 -> 12:20:00
  },
  {
    name: "retired model (prod row 10009)",
    upstream: 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}',
    status: 404,
    type: "not_found_error",
  },
  {
    name: "bare exit, no upstream text",
    status: 500,
    type: "server_error",
  },
  {
    name: "expired credentials",
    upstream: "API Error: 401 {\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid api key\"}}",
    status: 401,
    type: "authentication_error",
  },
  {
    name: "unknown upstream text stays a 500",
    upstream: "Something nobody has seen before",
    status: 500,
    type: "server_error",
  },
];

let failed = 0;
for (const c of cases) {
  const got = classifyUpstreamError(makeErr(c.upstream), NOW);
  const okStatus = got.status === c.status;
  const okType = got.type === c.type;
  const okRetry = c.retryAfter === undefined ? got.retryAfterSeconds === undefined : got.retryAfterSeconds === c.retryAfter;
  const okMessage = c.upstream ? got.message === c.upstream : got.message === EXIT;
  const ok = okStatus && okType && okRetry && okMessage;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.name}: ${got.status} ${got.type}` +
      `${got.retryAfterSeconds !== undefined ? ` retry_after=${got.retryAfterSeconds}s` : ""}` +
      (ok ? "" : `\n     expected ${c.status} ${c.type} retry_after=${c.retryAfter ?? "none"}, message=${JSON.stringify(got.message)}`)
  );
}

// A reset time earlier in the day means tomorrow, not a negative wait.
const nextDay = parseResetSeconds("resets 9:00am (UTC)", NOW);
// 11:36:45 -> 09:00:00 the next day = 21h 23m 15s.
const expected = 21 * 3600 + 23 * 60 + 15;
if (nextDay !== expected) {
  failed++;
  console.log(`FAIL past reset time rolls to tomorrow: got ${nextDay}, expected ${expected}`);
} else {
  console.log(`ok   past reset time rolls to tomorrow: ${nextDay}s`);
}

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
