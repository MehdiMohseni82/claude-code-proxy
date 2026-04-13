import { Router } from "express";
import { db } from "../db/connection.js";
import { getTaskCount } from "../services/taskTracker.js";
import { getTokenStatus } from "../services/settingsService.js";
import { OLLAMA_URL } from "../config.js";

const router = Router();

router.get("/health", async (_req, res) => {
  let dbStatus = "ok";
  try {
    db.pragma("quick_check");
  } catch {
    dbStatus = "error";
  }

  const token = getTokenStatus();

  let ollamaStatus = "unknown";
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaStatus = r.ok ? "ok" : "error";
  } catch {
    ollamaStatus = "unreachable";
  }

  res.json({
    status: "ok",
    backend: "claude-code-sdk",
    db_status: dbStatus,
    active_tasks: getTaskCount(),
    token_configured: token.configured,
    token_source: token.source,
    ollama_status: ollamaStatus,
  });
});

export default router;
