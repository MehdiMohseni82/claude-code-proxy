import { Router } from "express";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { resolveModel } from "../models.js";
import { OLLAMA_URL } from "../config.js";
import { insertPendingRequest, completeRequest } from "../services/historyService.js";

const router = Router();

router.post("/embeddings", async (req: Request, res: Response) => {
  try {
    const { model, input, encoding_format } = req.body;

    if (!input || (typeof input !== "string" && !Array.isArray(input))) {
      res.status(400).json({
        error: {
          message: "'input' is required and must be a string or array of strings",
          type: "invalid_request_error",
        },
      });
      return;
    }

    if (Array.isArray(input) && input.some((i: unknown) => typeof i !== "string")) {
      res.status(400).json({
        error: {
          message: "'input' array must contain only strings",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const requestedModel = model || "nomic-embed-text";
    const resolvedModel = resolveModel(requestedModel);
    const completionId = `embd-${uuidv4()}`;
    const startTime = Date.now();

    // Check model restrictions
    if (req.allowedModels && req.allowedModels.length > 0) {
      if (!req.allowedModels.includes(resolvedModel)) {
        res.status(403).json({
          error: {
            message: `This API key is not allowed to use model '${resolvedModel}'. Allowed: ${req.allowedModels.join(", ")}`,
            type: "permission_error",
          },
        });
        return;
      }
    }

    // Build a prompt preview for logging
    const inputTexts = Array.isArray(input) ? input : [input];
    const promptPreview = inputTexts[0].slice(0, 200);

    // Log pending request
    const logId = insertPendingRequest({
      apiKeyId: req.apiKeyId ?? null,
      completionId,
      requestedModel,
      resolvedModel,
      isStream: false,
      promptPreview,
      fullPrompt: inputTexts.join("\n---\n"),
    });

    // Forward to Ollama's OpenAI-compatible endpoint
    const ollamaBody: Record<string, unknown> = {
      model: resolvedModel,
      input,
    };
    if (encoding_format) {
      ollamaBody.encoding_format = encoding_format;
    }

    let ollamaRes: globalThis.Response;
    try {
      ollamaRes = await fetch(`${OLLAMA_URL}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaBody),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      completeRequest(logId, "error", {
        durationMs: Date.now() - startTime,
        errorMessage: `Ollama unreachable: ${message}`,
      });
      res.status(503).json({
        error: {
          message: "Embedding service (Ollama) is not available. Ensure Ollama is running and the model is pulled.",
          type: "service_unavailable",
        },
      });
      return;
    }

    const data = await ollamaRes.json();

    if (!ollamaRes.ok) {
      const errMsg = (data as { error?: string }).error || `Ollama returned ${ollamaRes.status}`;
      completeRequest(logId, "error", {
        durationMs: Date.now() - startTime,
        errorMessage: errMsg,
      });
      res.status(ollamaRes.status).json({
        error: {
          message: errMsg,
          type: "api_error",
        },
      });
      return;
    }

    // Extract usage from Ollama response
    const usage = (data as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage;
    const promptTokens = usage?.prompt_tokens ?? 0;

    // Build a readable summary of the embedding response for the detail view
    const embeddingData = (data as { data?: Array<{ embedding?: number[]; index?: number }> }).data;
    let responseSummary = "";
    if (embeddingData && Array.isArray(embeddingData)) {
      for (const item of embeddingData) {
        const vec = item.embedding;
        if (vec && Array.isArray(vec)) {
          const preview = vec.slice(0, 10).map((v) => v.toFixed(6)).join(", ");
          responseSummary += `[${item.index ?? 0}] ${vec.length} dimensions: [${preview}, ...]\n`;
        }
      }
    }

    completeRequest(logId, "success", {
      inputTokens: promptTokens,
      outputTokens: 0,
      totalCostUsd: 0, // local model, no cost
      durationMs: Date.now() - startTime,
      fullResponse: responseSummary || JSON.stringify(data),
    });

    res.json(data);
  } catch (error: unknown) {
    console.error("Error in /v1/embeddings:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({
      error: { message, type: "server_error" },
    });
  }
});

export default router;
