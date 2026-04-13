import { Router } from "express";
import { db } from "../db/connection.js";
import { getTaskCount } from "../services/taskTracker.js";
import { getTokenStatus } from "../services/settingsService.js";

const router = Router();

router.get("/health", (_req, res) => {
  let dbStatus = "ok";
  try {
    db.pragma("quick_check");
  } catch {
    dbStatus = "error";
  }

  const token = getTokenStatus();

  res.json({
    status: "ok",
    backend: "claude-code-sdk",
    db_status: dbStatus,
    active_tasks: getTaskCount(),
    token_configured: token.configured,
    token_source: token.source,
  });
});

export default router;
