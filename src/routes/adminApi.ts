import { Router } from "express";
import { createApiKey, listApiKeys, revokeApiKey, updateApiKey } from "../services/apiKeyService.js";
import { listTasks, cancelTask } from "../services/taskTracker.js";
import { queryHistory, getStats, getRequestDetail } from "../services/historyService.js";
import { getTokenStatus, setSetting, deleteSetting } from "../services/settingsService.js";
import { adminAuth } from "../middleware/adminAuth.js";

const router = Router();

// All admin routes require admin auth
router.use(adminAuth);

// --- API Keys ---

router.get("/keys", (_req, res) => {
  const keys = listApiKeys();
  res.json({ keys });
});

router.post("/keys", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({
      error: { message: "name is required", type: "invalid_request_error" },
    });
    return;
  }

  const result = createApiKey(name.trim());
  res.status(201).json(result);
});

router.patch("/keys/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({
      error: { message: "Invalid key ID", type: "invalid_request_error" },
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  const b = req.body;

  if (typeof b.allow_builtin_tools === "boolean") {
    updates.allow_builtin_tools = b.allow_builtin_tools ? 1 : 0;
  }
  if (b.rate_limit_rpm !== undefined) {
    updates.rate_limit_rpm = b.rate_limit_rpm === null ? null : parseInt(b.rate_limit_rpm);
  }
  if (b.rate_limit_tpm !== undefined) {
    updates.rate_limit_tpm = b.rate_limit_tpm === null ? null : parseInt(b.rate_limit_tpm);
  }
  if (b.monthly_budget_usd !== undefined) {
    updates.monthly_budget_usd = b.monthly_budget_usd === null ? null : parseFloat(b.monthly_budget_usd);
  }
  if (b.allowed_models !== undefined) {
    updates.allowed_models = b.allowed_models === null ? null : JSON.stringify(b.allowed_models);
  }
  if (b.system_prompt !== undefined) {
    updates.system_prompt = b.system_prompt === null ? null : String(b.system_prompt);
  }
  if (b.cache_ttl_seconds !== undefined) {
    updates.cache_ttl_seconds = b.cache_ttl_seconds === null ? null : parseInt(b.cache_ttl_seconds);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      error: { message: "No valid fields to update", type: "invalid_request_error" },
    });
    return;
  }

  updateApiKey(id, updates);
  res.json({ success: true });
});

router.delete("/keys/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({
      error: { message: "Invalid key ID", type: "invalid_request_error" },
    });
    return;
  }

  const revoked = revokeApiKey(id);
  if (!revoked) {
    res.status(404).json({
      error: { message: "Key not found or already revoked", type: "not_found" },
    });
    return;
  }

  res.json({ success: true });
});

// --- Settings (Claude token, etc.) ---

router.get("/settings/token", (_req, res) => {
  const status = getTokenStatus();
  res.json(status);
});

router.post("/settings/token", (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string" || token.trim().length < 10) {
    res.status(400).json({
      error: { message: "A valid token is required", type: "invalid_request_error" },
    });
    return;
  }

  setSetting("claude_oauth_token", token.trim());
  const status = getTokenStatus();
  res.json({ success: true, ...status });
});

router.delete("/settings/token", (_req, res) => {
  deleteSetting("claude_oauth_token");
  const status = getTokenStatus();
  res.json({ success: true, ...status });
});

// --- Active Tasks ---

router.get("/tasks", (_req, res) => {
  const tasks = listTasks();
  res.json({ tasks });
});

router.post("/tasks/:id/cancel", async (req, res) => {
  const cancelled = await cancelTask(req.params.id);
  if (!cancelled) {
    res.status(404).json({
      error: { message: "Task not found", type: "not_found" },
    });
    return;
  }
  res.json({ success: true });
});

// --- Request History ---

router.get("/history", (req, res) => {
  const result = queryHistory({
    limit: parseInt(req.query.limit as string) || 50,
    offset: parseInt(req.query.offset as string) || 0,
    api_key_id: req.query.api_key_id ? parseInt(req.query.api_key_id as string) : undefined,
    model: req.query.model as string | undefined,
    status: req.query.status as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });

  res.json(result);
});

// NOTE: /history/export and /history/stats MUST be defined before /history/:id,
// otherwise Express matches "export" or "stats" as the :id parameter.
router.get("/history/export", (req, res) => {
  const format = (req.query.format as string) || "json";
  if (format !== "csv" && format !== "json") {
    res.status(400).json({
      error: { message: "format must be 'csv' or 'json'", type: "invalid_request_error" },
    });
    return;
  }

  const result = queryHistory({
    limit: 10000,
    offset: 0,
    api_key_id: req.query.api_key_id ? parseInt(req.query.api_key_id as string) : undefined,
    model: req.query.model as string | undefined,
    status: req.query.status as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const headers = [
      "id", "api_key_name", "requested_model", "resolved_model", "is_stream",
      "input_tokens", "output_tokens", "total_cost_usd", "duration_ms",
      "status", "prompt_preview", "created_at", "completed_at",
    ];
    const csvRows = [headers.join(",")];
    for (const row of result.rows) {
      const r = row as unknown as Record<string, unknown>;
      csvRows.push(headers.map((h) => {
        const val = r[h];
        if (val == null) return "";
        const str = String(val);
        // Escape CSV values containing commas, quotes, or newlines
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=history-${timestamp}.csv`);
    res.send(csvRows.join("\n"));
  } else {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=history-${timestamp}.json`);
    res.json(result.rows);
  }
});
router.get("/history/stats", (req, res) => {
  const stats = getStats(
    req.query.from as string | undefined,
    req.query.to as string | undefined
  );
  res.json(stats);
});

router.get("/history/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({
      error: { message: "Invalid request ID", type: "invalid_request_error" },
    });
    return;
  }
  const detail = getRequestDetail(id);
  if (!detail) {
    res.status(404).json({
      error: { message: "Request not found", type: "not_found" },
    });
    return;
  }
  res.json(detail);
});

export default router;
