import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response } from "express";
import { trackedQuery } from "../services/sdkBridge.js";
import { cancelTask } from "../services/taskTracker.js";
import { AVAILABLE_MODELS, resolveModel } from "../models.js";
import {
  buildToolBridge,
  rewriteBlocksForClient,
  hasToolUse,
} from "../services/toolBridge.js";
import type { OutputBlock } from "../types/toolBridge.js";
import {
  openaiToolsToAnthropic,
  openaiMessagesToAnthropic,
  anthropicBlocksToOpenAIToolCalls,
  anthropicBlocksToOpenAIContent,
  anthropicStopToOpenAI,
  type OpenAITool,
} from "../services/openaiToolTranslator.js";

const router = Router();

// Proxy system preamble for tool-using requests (same as anthropic.ts)
const PROXY_SYSTEM_PREAMBLE =
  "You are a helpful assistant. The user may provide a set of tools; call them when appropriate using the tool-use mechanism. " +
  "You are NOT Claude Code. Do not mention files, paths, the shell, or any coding environment unless the user explicitly asks about them. " +
  "Respond concisely and directly.";

function messagesToPrompt(
  messages: Array<{ role: string; content: string }>
): string {
  if (messages.length === 1 && messages[0].role === "user") {
    return messages[0].content;
  }

  const parts: string[] = [];
  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        parts.push(`[System instruction]: ${msg.content}`);
        break;
      case "user":
        parts.push(`[User]: ${msg.content}`);
        break;
      case "assistant":
        parts.push(`[Assistant]: ${msg.content}`);
        break;
      default:
        parts.push(`[${msg.role}]: ${msg.content}`);
    }
  }
  return parts.join("\n\n");
}

// Build prompt from translated Anthropic messages (for tool-using requests).
function buildPromptFromTranslated(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      const role = msg.role === "user" ? "User" : "Assistant";
      parts.push(`[${role}]: ${msg.content}`);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    const segments: string[] = [];
    for (const block of msg.content) {
      const type = (block as { type?: string }).type;
      if (type === "text") {
        const t = (block as { text?: unknown }).text;
        if (typeof t === "string") segments.push(t);
      } else if (type === "tool_use") {
        const tu = block as { name?: string; input?: unknown };
        segments.push(`[called tool "${tu.name}" with input: ${JSON.stringify(tu.input ?? {})}]`);
      } else if (type === "tool_result") {
        const tr = block as { tool_use_id?: string; content?: unknown; is_error?: boolean };
        const text = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
        const label = tr.is_error ? "tool error" : "tool result";
        segments.push(`[${label} (id=${tr.tool_use_id})]: ${text}`);
      }
    }
    if (segments.length > 0) {
      const role = msg.role === "user" ? "User" : "Assistant";
      parts.push(`[${role}]: ${segments.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

// GET /v1/models
router.get("/models", (_req, res) => {
  res.json({
    object: "list",
    data: AVAILABLE_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "anthropic",
    })),
  });
});

// POST /v1/chat/completions
router.post("/chat/completions", async (req: Request, res: Response) => {
  try {
    const { model, messages, stream = false, tools, tool_choice } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const requestedModel = model || "claude-sonnet-4-6";
    const resolvedModel = resolveModel(requestedModel);
    const completionId = `chatcmpl-${uuidv4()}`;

    // Check model restrictions for this API key
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

    // Detect tool-using request
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const hasToolMessages = messages.some(
      (m: Record<string, unknown>) =>
        m.role === "tool" ||
        (m.role === "assistant" && Array.isArray((m as { tool_calls?: unknown }).tool_calls))
    );

    if (hasTools || hasToolMessages) {
      await handleWithTools(req, res, {
        completionId,
        requestedModel,
        resolvedModel,
        stream,
        messages,
        tools: hasTools ? (tools as OpenAITool[]) : [],
      });
      return;
    }

    // Plain text path — prepend per-key system prompt if set
    let prompt = messagesToPrompt(messages);
    if (req.keySystemPrompt) {
      prompt = `[System instruction]: ${req.keySystemPrompt}\n\n${prompt}`;
    }
    if (stream) {
      await handleStreamingRequest(req, res, completionId, requestedModel, resolvedModel, prompt);
    } else {
      await handleNonStreamingRequest(req, res, completionId, requestedModel, resolvedModel, prompt);
    }
  } catch (error: any) {
    console.error("Error in /v1/chat/completions:", error);
    res.status(500).json({
      error: {
        message: error.message || "Internal server error",
        type: "server_error",
      },
    });
  }
});

// ---- Tool-using handler (OpenAI format) ----

interface HandleWithToolsParams {
  completionId: string;
  requestedModel: string;
  resolvedModel: string;
  stream: boolean;
  messages: Array<Record<string, unknown>>;
  tools: OpenAITool[];
}

async function handleWithTools(
  req: Request,
  res: Response,
  p: HandleWithToolsParams
): Promise<void> {
  // Translate OpenAI tools → Anthropic format
  const clientTools = openaiToolsToAnthropic(p.tools);

  let bridge;
  try {
    bridge = buildToolBridge(clientTools);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to build tool bridge";
    res.status(400).json({ error: { message, type: "invalid_request_error" } });
    return;
  }

  // Translate OpenAI messages → Anthropic format
  const anthropicMessages = openaiMessagesToAnthropic(p.messages);

  // Extract system prompt from messages, merge with per-key system prompt
  const systemMsg = p.messages.find((m) => m.role === "system");
  const clientSystem = systemMsg ? (systemMsg.content as string) : undefined;
  const systemParts = [PROXY_SYSTEM_PREAMBLE];
  if (req.keySystemPrompt) systemParts.push(req.keySystemPrompt);
  if (clientSystem) systemParts.push(clientSystem);
  const systemPrompt = systemParts.join("\n\n");

  const prompt = buildPromptFromTranslated(anthropicMessages);

  const { generator } = trackedQuery({
    completionId: p.completionId,
    prompt,
    requestedModel: p.requestedModel,
    resolvedModel: p.resolvedModel,
    isStreaming: p.stream,
    apiKeyId: req.apiKeyId ?? null,
    apiKeyName: req.apiKeyName ?? null,
    mcpServers: bridge.mcpServers,
    allowedTools: bridge.allowedTools,
    builtInTools: [],
    systemPrompt,
    maxTurns: 1,
  });

  // Capture blocks from assistant messages (same pattern as anthropic.ts)
  const capturedBlocks: OutputBlock[] = [];
  let sawToolUse = false;
  let inputTokens = 0;
  let outputTokens = 0;

  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
    cancelTask(p.completionId);
  });

  try {
    let toolResultSeen = false;
    for await (const message of generator) {
      if (clientDisconnected) break;

      if (message.type === "assistant" && !toolResultSeen) {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          const rewritten = rewriteBlocksForClient(
            content as Array<Record<string, unknown>>,
            bridge.mcpToClient
          );
          if (rewritten.length > 0) {
            capturedBlocks.push(...rewritten);
            if (hasToolUse(rewritten)) sawToolUse = true;
          }
        }
      } else if (message.type === "user") {
        toolResultSeen = true;
      } else if (message.type === "result") {
        const usage = message.usage as Record<string, number | undefined> | undefined;
        inputTokens = usage?.input_tokens ?? 0;
        outputTokens = usage?.output_tokens ?? 0;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (!res.headersSent) {
      res.status(500).json({ error: { message, type: "server_error" } });
    }
    return;
  }

  if (clientDisconnected) return;

  // Build OpenAI response
  const textContent = anthropicBlocksToOpenAIContent(capturedBlocks);
  const toolCalls = anthropicBlocksToOpenAIToolCalls(capturedBlocks);
  const stopReason = sawToolUse ? "tool_use" : "end_turn";
  const finishReason = anthropicStopToOpenAI(stopReason);

  const responseMessage: Record<string, unknown> = {
    role: "assistant",
    content: textContent,
  };
  if (toolCalls) {
    responseMessage.tool_calls = toolCalls;
  }

  if (p.stream) {
    // Buffered fake-streaming for tool responses
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const chunk = {
      id: p.completionId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: p.resolvedModel,
      choices: [
        {
          index: 0,
          delta: responseMessage,
          finish_reason: finishReason,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.json({
      id: p.completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: p.resolvedModel,
      choices: [
        {
          index: 0,
          message: responseMessage,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    });
  }
}

// ---- Plain text handlers (no tools) ----

async function handleNonStreamingRequest(
  req: Request,
  res: Response,
  completionId: string,
  requestedModel: string,
  resolvedModel: string,
  prompt: string
) {
  const { generator } = trackedQuery({
    completionId,
    prompt,
    requestedModel,
    resolvedModel,
    isStreaming: false,
    apiKeyId: req.apiKeyId ?? null,
    apiKeyName: req.apiKeyName ?? null,
  });

  let resultText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const message of generator) {
    if (message.type === "assistant") {
      const textBlocks = message.message.content.filter(
        (b: any) => b.type === "text"
      );
      resultText += textBlocks.map((b: any) => b.text).join("");
    } else if (message.type === "result") {
      inputTokens = message.usage.input_tokens || 0;
      outputTokens = message.usage.output_tokens || 0;
      if (!resultText && message.subtype === "success") {
        resultText = message.result;
      }
    }
  }

  res.json({
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: resultText },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
}

async function handleStreamingRequest(
  req: Request,
  res: Response,
  completionId: string,
  requestedModel: string,
  resolvedModel: string,
  prompt: string
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const { generator } = trackedQuery({
    completionId,
    prompt,
    requestedModel,
    resolvedModel,
    isStreaming: true,
    apiKeyId: req.apiKeyId ?? null,
    apiKeyName: req.apiKeyName ?? null,
    includePartialMessages: true,
  });

  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
    cancelTask(completionId);
  });

  const initialChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
  };
  res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

  for await (const message of generator) {
    if (clientDisconnected) break;

    if (message.type === "stream_event") {
      const event = message.event as any;
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        const chunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: resolvedModel,
          choices: [
            {
              index: 0,
              delta: { content: event.delta.text },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } else if (message.type === "result") {
      const finalChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: resolvedModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    }
  }

  if (!clientDisconnected) {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

export default router;
