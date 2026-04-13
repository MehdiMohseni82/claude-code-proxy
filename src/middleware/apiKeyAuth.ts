import type { Request, Response, NextFunction } from "express";
import { validateApiKey, hasAnyKeys } from "../services/apiKeyService.js";
import { AUTH_DISABLED } from "../config.js";

// Extend Express Request to include API key info
declare global {
  namespace Express {
    interface Request {
      apiKeyId?: number;
      apiKeyName?: string;
      allowBuiltinTools?: boolean;
      rateLimitRpm?: number | null;
      rateLimitTpm?: number | null;
      monthlyBudgetUsd?: number | null;
      allowedModels?: string[] | null;
      keySystemPrompt?: string | null;
      cacheTtlSeconds?: number | null;
    }
  }
}

// Which response format to use for auth errors.
// Anthropic routes (/messages, /messages/count_tokens) get Anthropic-style errors;
// everything else gets OpenAI-style (so openai SDK clients can parse them).
function isAnthropicRoute(req: Request): boolean {
  const p = req.path;
  return p === "/messages" || p.startsWith("/messages/");
}

function sendAuthError(req: Request, res: Response, message: string): void {
  if (isAnthropicRoute(req)) {
    res.status(401).json({
      type: "error",
      error: { type: "authentication_error", message },
    });
  } else {
    res.status(401).json({
      error: { message, type: "authentication_error" },
    });
  }
}

// Extract the API key from either Authorization: Bearer <key> (OpenAI style)
// or x-api-key: <key> (native Anthropic style). Accept both so the same key
// works with either the openai SDK or the @anthropic-ai/sdk.
function extractApiKey(req: Request): string | null {
  // 1. Authorization: Bearer <key>
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // 2. x-api-key: <key>
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.length > 0) {
    return xApiKey.trim();
  }

  return null;
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if disabled via env var
  if (AUTH_DISABLED) {
    next();
    return;
  }

  // If no keys exist yet, allow all requests (backward compatible)
  if (!hasAnyKeys()) {
    next();
    return;
  }

  const rawKey = extractApiKey(req);
  if (!rawKey) {
    sendAuthError(
      req,
      res,
      "Missing API key. Send it as 'Authorization: Bearer <key>' or 'x-api-key: <key>'."
    );
    return;
  }

  const apiKey = validateApiKey(rawKey);
  if (!apiKey) {
    sendAuthError(req, res, "Invalid API key");
    return;
  }

  req.apiKeyId = apiKey.id;
  req.apiKeyName = apiKey.name;
  req.allowBuiltinTools = apiKey.allow_builtin_tools === 1;
  req.rateLimitRpm = apiKey.rate_limit_rpm;
  req.rateLimitTpm = apiKey.rate_limit_tpm;
  req.monthlyBudgetUsd = apiKey.monthly_budget_usd;
  req.keySystemPrompt = apiKey.system_prompt;
  req.cacheTtlSeconds = apiKey.cache_ttl_seconds;

  // Parse allowed_models JSON
  if (apiKey.allowed_models) {
    try { req.allowedModels = JSON.parse(apiKey.allowed_models); } catch { req.allowedModels = null; }
  } else {
    req.allowedModels = null;
  }

  next();
}
