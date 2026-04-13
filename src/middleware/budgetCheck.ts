import type { Request, Response, NextFunction } from "express";
import { db } from "../db/connection.js";

// Cache budget usage per key to avoid hitting SQLite on every request.
// Cache entries expire after 60 seconds.
interface CacheEntry {
  monthCost: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<number, CacheEntry>();

function getMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function getMonthCost(keyId: number): number {
  const cached = cache.get(keyId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.monthCost;
  }

  const monthStart = getMonthStart();
  const row = db.prepare(
    "SELECT COALESCE(SUM(total_cost_usd), 0) as month_cost FROM request_log WHERE api_key_id = ? AND created_at >= ?"
  ).get(keyId, monthStart) as { month_cost: number };

  cache.set(keyId, { monthCost: row.month_cost, cachedAt: now });
  return row.month_cost;
}

function isAnthropicRoute(req: Request): boolean {
  const p = req.path;
  return p === "/messages" || p.startsWith("/messages/");
}

function sendBudgetError(req: Request, res: Response, message: string): void {
  if (isAnthropicRoute(req)) {
    res.status(402).json({
      type: "error",
      error: { type: "budget_exceeded", message },
    });
  } else {
    res.status(402).json({
      error: { message, type: "budget_exceeded" },
    });
  }
}

export function budgetCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
  const keyId = req.apiKeyId;
  const budget = req.monthlyBudgetUsd;

  // No key or no budget configured — skip
  if (!keyId || budget == null) {
    next();
    return;
  }

  const monthCost = getMonthCost(keyId);
  if (monthCost >= budget) {
    sendBudgetError(
      req, res,
      `Monthly budget exceeded: $${monthCost.toFixed(4)} spent of $${budget.toFixed(2)} budget. Resets on the 1st of next month.`
    );
    return;
  }

  next();
}

/**
 * Invalidate the cached cost for a key so the next request gets a fresh value.
 * Called after a request completes to keep the cache reasonably fresh.
 */
export function invalidateBudgetCache(keyId: number): void {
  cache.delete(keyId);
}
