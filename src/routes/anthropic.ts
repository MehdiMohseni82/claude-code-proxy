import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "fs";
import type { Request, Response } from "express";
import { trackedQuery } from "../services/sdkBridge.js";
import { cancelTask } from "../services/taskTracker.js";
import { resolveModel } from "../models.js";
import {
  buildToolBridge,
  rewriteBlocksForClient,
  hasToolUse,
  isServerTool,
  mapServerToolToBuiltin,
} from "../services/toolBridge.js";
import type {
  ClientTool,
  ClientToolChoice,
  OutputBlock,
} from "../types/toolBridge.js";

const router = Router();

// ---------------- Types (subset of Anthropic Messages API) ----------------

type TextBlock = { type: "text"; text: string };
type ToolUseBlockIn = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type ToolResultBlockIn = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<Record<string, unknown>>;
  is_error?: boolean;
};
type ContentBlock =
  | TextBlock
  | ToolUseBlockIn
  | ToolResultBlockIn
  | { type: string; [k: string]: unknown };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  system?: string | ContentBlock[];
  stream?: boolean;
  // Now accepted:
  tools?: ClientTool[];
  tool_choice?: ClientToolChoice;
  // Accepted-but-ignored:
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: unknown;
  service_tier?: string;
  // Still rejected:
  thinking?: unknown;
}

// Proxy system preamble: overrides Claude Code's default system prompt so
// Claude behaves like a generic helpful assistant instead of a code agent.
const PROXY_SYSTEM_PREAMBLE =
  "You are a helpful assistant. The user may provide a set of tools; call them when appropriate using the tool-use mechanism. " +
  "You are NOT Claude Code. Do not mention files, paths, the shell, or any coding environment unless the user explicitly asks about them. " +
  "Respond concisely and directly.";

// ---------------- Helpers ----------------

function anthropicError(
  res: Response,
  status: number,
  type: string,
  message: string
): void {
  res.status(status).json({
    type: "error",
    error: { type, message },
  });
}

function makeMessageId(): string {
  return `msg_${uuidv4().replace(/-/g, "")}`;
}

// Extract text from a content array, ignoring non-text blocks.
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is TextBlock => b?.type === "text" && typeof (b as TextBlock).text === "string")
    .map((b) => b.text)
    .join("");
}

// Flatten a tool_result block's content to a single text string.
function flattenToolResultContent(content: ToolResultBlockIn["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && (block as { type?: string }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

function normalizeSystem(system: AnthropicRequest["system"]): string | undefined {
  if (system == null) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .filter((b): b is TextBlock => b?.type === "text" && typeof (b as TextBlock).text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return undefined;
}

// Build a single prompt string encoding the full conversation history.
// Handles text, tool_use, and tool_result blocks.
function buildPromptFromHistory(messages: AnthropicMessage[]): string {
  // Shortcut: single user-text message → raw text.
  if (
    messages.length === 1 &&
    messages[0].role === "user" &&
    typeof messages[0].content === "string"
  ) {
    return messages[0].content;
  }

  const parts: string[] = [];
  for (const msg of messages) {
    const content = msg.content;
    if (typeof content === "string") {
      parts.push(`[${msg.role === "user" ? "User" : "Assistant"}]: ${content}`);
      continue;
    }
    if (!Array.isArray(content)) continue;

    // Concatenate text blocks; encode tool_use, tool_result, images, and docs as labeled text.
    const segments: string[] = [];
    for (const block of content) {
      const type = (block as { type?: string }).type;
      if (type === "text") {
        const t = (block as { text?: unknown }).text;
        if (typeof t === "string") segments.push(t);
      } else if (type === "tool_use") {
        const tu = block as ToolUseBlockIn;
        segments.push(
          `[called tool "${tu.name}" with input: ${JSON.stringify(tu.input ?? {})}]`
        );
      } else if (type === "tool_result") {
        const tr = block as ToolResultBlockIn;
        const text = flattenToolResultContent(tr.content);
        const label = tr.is_error ? "tool error" : "tool result";
        segments.push(`[${label} (id=${tr.tool_use_id})]: ${text}`);
      } else if (type === "image") {
        segments.push("[image attached — note: image content is not viewable through this proxy]");
      } else if (type === "document") {
        const doc = block as { title?: string };
        const title = doc.title ?? "untitled";
        segments.push(`[document attached: "${title}" — note: document content is not viewable through this proxy]`);
      }
    }
    if (segments.length > 0) {
      const role = msg.role === "user" ? "User" : "Assistant";
      parts.push(`[${role}]: ${segments.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

// Merge proxy preamble with per-key system prompt and client-supplied system prompt.
function buildSystemPrompt(clientSystem: string | undefined, keySystemPrompt?: string | null): string {
  const parts = [PROXY_SYSTEM_PREAMBLE];
  if (keySystemPrompt) parts.push(keySystemPrompt);
  if (clientSystem) parts.push(clientSystem);
  return parts.join("\n\n");
}

// ---------------- Validation ----------------

type ValidationError = [number, string, string];

function validateToolsArray(tools: unknown): ValidationError | ClientTool[] {
  if (!Array.isArray(tools)) {
    return [400, "invalid_request_error", "'tools' must be an array"];
  }
  const seenNames = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i] as Record<string, unknown>;
    if (!t || typeof t !== "object") {
      return [400, "invalid_request_error", `tools[${i}] must be an object`];
    }
    // Server tools (e.g. {type: "web_search_20260209", name: "web_search"})
    // have a versioned type field and don't need input_schema.
    if (isServerTool(t)) {
      const name = (t.name as string) ?? (t.type as string);
      if (seenNames.has(name)) {
        return [400, "invalid_request_error", `tools[${i}] name '${name}' is duplicated`];
      }
      seenNames.add(name);
      continue;
    }
    // User-defined tools require name + input_schema.
    if (typeof t.name !== "string" || t.name.length === 0) {
      return [400, "invalid_request_error", `tools[${i}].name is required`];
    }
    if (seenNames.has(t.name)) {
      return [
        400,
        "invalid_request_error",
        `tools[${i}].name '${t.name}' is duplicated`,
      ];
    }
    seenNames.add(t.name);
    if (!t.input_schema || typeof t.input_schema !== "object") {
      return [
        400,
        "invalid_request_error",
        `tools[${i}].input_schema is required and must be an object`,
      ];
    }
  }
  return tools as ClientTool[];
}

function validateContentBlocks(
  content: string | ContentBlock[],
  location: string
): ValidationError | null {
  if (typeof content === "string") return null;
  if (!Array.isArray(content)) {
    return [
      400,
      "invalid_request_error",
      `Invalid content format in ${location}: expected string or array of content blocks`,
    ];
  }
  const allowedTypes = new Set([
    "text", "tool_use", "tool_result", "image", "document",
  ]);
  for (const block of content) {
    if (!block || typeof block !== "object") {
      return [400, "invalid_request_error", `Invalid content block in ${location}`];
    }
    const blockType = (block as { type?: string }).type;
    if (!blockType || !allowedTypes.has(blockType)) {
      return [
        400,
        "invalid_request_error",
        `Content block type '${blockType}' in ${location} is not supported. Supported: text, tool_use, tool_result, image, document.`,
      ];
    }
    if (blockType === "tool_use") {
      const tu = block as Record<string, unknown>;
      if (typeof tu.id !== "string" || typeof tu.name !== "string") {
        return [
          400,
          "invalid_request_error",
          `tool_use block in ${location} must have string 'id' and 'name'`,
        ];
      }
    }
    if (blockType === "tool_result") {
      const tr = block as Record<string, unknown>;
      if (typeof tr.tool_use_id !== "string") {
        return [
          400,
          "invalid_request_error",
          `tool_result block in ${location} must have a string 'tool_use_id'`,
        ];
      }
    }
  }
  return null;
}

function validateRequest(body: AnthropicRequest): ValidationError | null {
  if (!body || typeof body !== "object") {
    return [400, "invalid_request_error", "Request body must be a JSON object"];
  }

  if (!body.model || typeof body.model !== "string") {
    return [400, "invalid_request_error", "Field 'model' is required and must be a string"];
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return [
      400,
      "invalid_request_error",
      "Field 'messages' is required and must be a non-empty array",
    ];
  }

  if (body.thinking !== undefined) {
    return [
      400,
      "invalid_request_error",
      "This proxy does not support extended thinking. Remove the 'thinking' field.",
    ];
  }

  // Validate system (only text blocks allowed)
  if (body.system !== undefined && typeof body.system !== "string") {
    if (!Array.isArray(body.system)) {
      return [400, "invalid_request_error", "system must be a string or array of content blocks"];
    }
    for (const block of body.system) {
      const type = (block as { type?: string }).type;
      if (type !== "text") {
        return [
          400,
          "invalid_request_error",
          `system content block type '${type}' is not supported. Use 'text' only.`,
        ];
      }
    }
  }

  // Validate messages content blocks
  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (!msg || typeof msg !== "object") {
      return [400, "invalid_request_error", `messages[${i}] must be an object`];
    }
    if (msg.role !== "user" && msg.role !== "assistant") {
      return [
        400,
        "invalid_request_error",
        `messages[${i}].role must be 'user' or 'assistant'`,
      ];
    }
    const err = validateContentBlocks(msg.content, `messages[${i}].content`);
    if (err) return err;
  }

  return null;
}

// Detect whether the request needs the tool path.
// Goes down the tools path if any of:
// - body.tools is present and non-empty
// - any message contains a tool_use or tool_result content block
function needsToolPath(body: AnthropicRequest): boolean {
  if (Array.isArray(body.tools) && body.tools.length > 0) return true;
  for (const msg of body.messages) {
    if (typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      const t = (block as { type?: string }).type;
      if (t === "tool_use" || t === "tool_result") return true;
    }
  }
  return false;
}

// ---------------- Route ----------------

router.post("/messages", async (req: Request, res: Response) => {
  try {
    const body = req.body as AnthropicRequest;

    const validationError = validateRequest(body);
    if (validationError) {
      const [status, type, message] = validationError;
      anthropicError(res, status, type, message);
      return;
    }

    const messageId = makeMessageId();
    const requestedModel = body.model;
    const resolvedModel = resolveModel(requestedModel);
    const stream = body.stream === true;

    // Check model restrictions for this API key
    if (req.allowedModels && req.allowedModels.length > 0) {
      if (!req.allowedModels.includes(resolvedModel)) {
        anthropicError(
          res,
          403,
          "permission_error",
          `This API key is not allowed to use model '${resolvedModel}'. Allowed: ${req.allowedModels.join(", ")}`
        );
        return;
      }
    }

    // Check for built-in tools request (Claude Code's native tools)
    const enableBuiltins = req.headers["x-enable-builtin-tools"] === "true";
    if (enableBuiltins) {
      if (!req.allowBuiltinTools) {
        anthropicError(
          res,
          403,
          "permission_error",
          "This API key does not have permission to use built-in tools. Enable it in the admin dashboard."
        );
        return;
      }

      await handleBuiltinTools(req, res, {
        messageId,
        requestedModel,
        resolvedModel,
        stream,
        body,
      });
      return;
    }

    if (needsToolPath(body)) {
      // Validate tools (if present). Tool path requires either tools OR history
      // containing tool_use/tool_result blocks.
      let clientTools: ClientTool[] = [];
      if (body.tools !== undefined) {
        const toolsResult = validateToolsArray(body.tools);
        if (!Array.isArray(toolsResult) || typeof toolsResult[0] === "number") {
          // It's a ValidationError tuple
          const ve = toolsResult as ValidationError;
          anthropicError(res, ve[0], ve[1], ve[2]);
          return;
        }
        clientTools = toolsResult as ClientTool[];
      }
      // If the path is triggered only by history blocks (no tools in request),
      // that's a follow-up where tools should be re-sent. Allow it (the prior
      // tool_use/tool_result pairs are encoded into the prompt as text context).
      // NOTE: this is more permissive than the Anthropic API, but avoids rejecting
      // valid multi-turn flows where the client drops tools from the request.

      await handleWithTools(req, res, {
        messageId,
        requestedModel,
        resolvedModel,
        stream,
        body,
        clientTools,
      });
      return;
    }

    // Plain-text path: no tools, no tool_use/tool_result history. Existing behavior.
    const systemText = normalizeSystem(body.system);
    const prompt = buildPromptFromHistory(body.messages);
    const systemParts: string[] = [];
    if (req.keySystemPrompt) systemParts.push(req.keySystemPrompt);
    if (systemText) systemParts.push(systemText);
    const fullPrompt = systemParts.length > 0
      ? `[System instruction]: ${systemParts.join("\n\n")}\n\n${prompt}`
      : prompt;

    if (stream) {
      await handleStreamingPlain(req, res, messageId, requestedModel, resolvedModel, fullPrompt);
    } else {
      await handleNonStreamingPlain(req, res, messageId, requestedModel, resolvedModel, fullPrompt);
    }
  } catch (error: unknown) {
    console.error("Error in /v1/messages:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    anthropicError(res, 500, "api_error", message);
  }
});

// ---------------- Tool-path handler ----------------

interface HandleWithToolsParams {
  messageId: string;
  requestedModel: string;
  resolvedModel: string;
  stream: boolean;
  body: AnthropicRequest;
  clientTools: ClientTool[];
}

async function handleWithTools(
  req: Request,
  res: Response,
  p: HandleWithToolsParams
): Promise<void> {
  // Separate tools into server-side (map to Claude Code built-ins) and
  // user-defined (register via MCP for interception).
  const serverBuiltins: string[] = [];
  const userTools: ClientTool[] = [];

  for (const t of p.clientTools) {
    const raw = t as unknown as Record<string, unknown>;
    if (isServerTool(raw)) {
      const builtin = mapServerToolToBuiltin(raw.type as string);
      if (builtin) {
        serverBuiltins.push(builtin);
      }
    } else {
      userTools.push(t);
    }
  }

  // Build MCP bridge only for user-defined tools.
  let bridge;
  try {
    bridge = userTools.length > 0 ? buildToolBridge(userTools) : null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to build tool bridge";
    anthropicError(res, 400, "invalid_request_error", message);
    return;
  }

  const hasServerTools = serverBuiltins.length > 0;
  const hasUserTools = bridge !== null;

  // When server tools are present, we need higher maxTurns so the SDK can
  // run the tool, feed the result back to Claude, and get a final answer.
  // When ONLY user tools: maxTurns=1 (existing single-turn interception).
  const maxTurns = hasServerTools ? 10 : 1;

  // Built-in tools list: start with server tools; add nothing else (user tools
  // go via MCP). If no server tools and no user tools (shouldn't happen), empty.
  const builtInTools = hasServerTools ? serverBuiltins : [];

  const clientSystem = normalizeSystem(p.body.system);
  const systemPrompt = buildSystemPrompt(clientSystem, req.keySystemPrompt);
  const prompt = buildPromptFromHistory(p.body.messages);

  const { generator } = trackedQuery({
    completionId: p.messageId,
    prompt,
    requestedModel: p.requestedModel,
    resolvedModel: p.resolvedModel,
    isStreaming: p.stream,
    apiKeyId: req.apiKeyId ?? null,
    apiKeyName: req.apiKeyName ?? null,
    mcpServers: hasUserTools && bridge ? bridge.mcpServers : undefined,
    allowedTools: hasUserTools && bridge ? bridge.allowedTools : undefined,
    builtInTools,
    systemPrompt,
    maxTurns,
    permissionMode: hasServerTools ? "acceptEdits" : undefined,
  });

  const capturedBlocks: OutputBlock[] = [];
  let sawToolUse = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  // Set up client-disconnect cancellation (res.on, not req.on — see comment in proxy.ts)
  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
    cancelTask(p.messageId);
  });

  // Claude can split one logical assistant response across multiple `assistant`
  // generator messages (e.g., a text message followed by a tool_use message).
  // We accumulate blocks from all assistant messages that precede the SDK's
  // synthetic user message (containing our sentinel tool_result) or result message.
  try {
    let toolResultSeen = false;
    for await (const message of generator) {
      if (clientDisconnected) break;

      if (message.type === "assistant" && !toolResultSeen) {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          const nameMap = bridge?.mcpToClient ?? new Map<string, string>();
          const rewritten = rewriteBlocksForClient(
            content as Array<Record<string, unknown>>,
            nameMap
          );
          if (rewritten.length > 0) {
            capturedBlocks.push(...rewritten);
            if (hasToolUse(rewritten)) sawToolUse = true;
          }
        }
      } else if (message.type === "user") {
        // The SDK synthesizes a user message with the tool_result when our
        // sentinel handler returns. Anything after this point is a second turn
        // (Claude's reaction to the sentinel), which we must ignore.
        toolResultSeen = true;
      } else if (message.type === "result") {
        const usage = message.usage as Record<string, number | undefined> | undefined;
        inputTokens = usage?.input_tokens ?? 0;
        outputTokens = usage?.output_tokens ?? 0;
        cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
        cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
        // Note: subtype may be "error_max_turns" when a tool was called under maxTurns:1.
        // That's expected and fine — we've already captured the tool_use block.
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (!res.headersSent) {
      anthropicError(res, 500, "api_error", message);
    }
    return;
  }

  if (clientDisconnected) return;

  // If we captured nothing (pathological), emit an empty text block.
  if (capturedBlocks.length === 0) {
    capturedBlocks.push({ type: "text", text: "" });
  }

  const stopReason = sawToolUse ? "tool_use" : "end_turn";

  const responseEnvelope = {
    id: p.messageId,
    type: "message" as const,
    role: "assistant" as const,
    content: capturedBlocks,
    model: p.resolvedModel,
    stop_reason: stopReason as "tool_use" | "end_turn" | "max_tokens" | "stop_sequence",
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  };

  if (p.stream) {
    emitBufferedStream(res, responseEnvelope);
  } else {
    res.json(responseEnvelope);
  }
}

// ---- Built-in tools handler (Claude Code's Bash/Read/Edit/etc.) ----

const ALL_BUILTIN_TOOLS = [
  "Bash", "Read", "Edit", "Write", "Glob", "Grep",
  "WebFetch", "WebSearch", "NotebookEdit", "Agent",
];

interface HandleBuiltinParams {
  messageId: string;
  requestedModel: string;
  resolvedModel: string;
  stream: boolean;
  body: AnthropicRequest;
}

async function handleBuiltinTools(
  req: Request,
  res: Response,
  p: HandleBuiltinParams
): Promise<void> {
  const clientSystem = normalizeSystem(p.body.system);
  const prompt = buildPromptFromHistory(p.body.messages);

  // Per-key workspace directory for filesystem isolation
  const keyId = req.apiKeyId ?? 0;
  const workspaceDir = `/app/data/workspaces/${keyId}`;
  try { mkdirSync(workspaceDir, { recursive: true }); } catch { /* ignore */ }

  const { generator } = trackedQuery({
    completionId: p.messageId,
    prompt,
    requestedModel: p.requestedModel,
    resolvedModel: p.resolvedModel,
    isStreaming: p.stream,
    apiKeyId: req.apiKeyId ?? null,
    apiKeyName: req.apiKeyName ?? null,
    builtInTools: ALL_BUILTIN_TOOLS,
    systemPrompt: [req.keySystemPrompt, clientSystem].filter(Boolean).join("\n\n") || undefined,
    maxTurns: 20,
    permissionMode: "acceptEdits",
    cwd: workspaceDir,
    includePartialMessages: p.stream,
  });

  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
    cancelTask(p.messageId);
  });

  if (p.stream) {
    // For built-in tools, use real streaming — Claude Code runs autonomously
    // and we forward all stream_event messages as they arrive.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (eventType: string, data: unknown) => {
      if (clientDisconnected) return;
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const message of generator) {
        if (clientDisconnected) break;
        if (message.type !== "stream_event") continue;
        const event = message.event as Record<string, unknown> & { type: string };
        if (event.type === "message_start") {
          const inner = event.message as Record<string, unknown> | undefined;
          if (inner) {
            writeEvent(event.type, {
              ...event,
              message: { ...inner, id: p.messageId, model: p.resolvedModel },
            });
            continue;
          }
        }
        writeEvent(event.type, event);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      writeEvent("error", { type: "error", error: { type: "api_error", message: msg } });
    }
    if (!clientDisconnected) res.end();
  } else {
    // Non-streaming: collect all assistant text across multiple turns.
    let resultText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    for await (const message of generator) {
      if (clientDisconnected) break;
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as { type: string }).type === "text") {
              resultText += (block as { text: string }).text;
            }
          }
        }
      } else if (message.type === "result") {
        const usage = message.usage as Record<string, number | undefined> | undefined;
        inputTokens = usage?.input_tokens ?? 0;
        outputTokens = usage?.output_tokens ?? 0;
        cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
        cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
        if (!resultText && message.subtype === "success") {
          resultText = message.result as string ?? "";
        }
      }
    }

    if (clientDisconnected) return;

    res.json({
      id: p.messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: resultText }],
      model: p.resolvedModel,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreationTokens,
        cache_read_input_tokens: cacheReadTokens,
      },
    });
  }
}

// Buffered fake-streaming: once we have the full response, synthesize
// the Anthropic SSE event sequence and flush it all at once.
function emitBufferedStream(
  res: Response,
  envelope: {
    id: string;
    type: "message";
    role: "assistant";
    content: OutputBlock[];
    model: string;
    stop_reason: "tool_use" | "end_turn" | "max_tokens" | "stop_sequence";
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  }
): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (eventType: string, data: unknown) => {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // message_start
  write("message_start", {
    type: "message_start",
    message: {
      id: envelope.id,
      type: "message",
      role: "assistant",
      content: [],
      model: envelope.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: envelope.usage.input_tokens,
        cache_creation_input_tokens: envelope.usage.cache_creation_input_tokens,
        cache_read_input_tokens: envelope.usage.cache_read_input_tokens,
        output_tokens: 0,
      },
    },
  });

  // content blocks
  envelope.content.forEach((block, index) => {
    if (block.type === "text") {
      write("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      if (block.text.length > 0) {
        write("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: block.text },
        });
      }
      write("content_block_stop", { type: "content_block_stop", index });
    } else if (block.type === "tool_use") {
      write("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      write("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
      write("content_block_stop", { type: "content_block_stop", index });
    }
  });

  // message_delta with stop_reason and final output_tokens
  write("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: envelope.stop_reason,
      stop_sequence: null,
    },
    usage: { output_tokens: envelope.usage.output_tokens },
  });

  // message_stop
  write("message_stop", { type: "message_stop" });

  res.end();
}

// ---------------- Plain-text handlers (unchanged from previous version) ----------------

async function handleNonStreamingPlain(
  req: Request,
  res: Response,
  messageId: string,
  requestedModel: string,
  resolvedModel: string,
  prompt: string
): Promise<void> {
  const { generator } = trackedQuery({
    completionId: messageId,
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
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" = "end_turn";

  for await (const message of generator) {
    if (message.type === "assistant") {
      const blocks = (message.message.content as Array<{ type: string; text?: string }>).filter(
        (b) => b.type === "text"
      );
      resultText += blocks.map((b) => b.text ?? "").join("");
    } else if (message.type === "result") {
      const usage = message.usage as Record<string, number | undefined> | undefined;
      inputTokens = usage?.input_tokens ?? 0;
      outputTokens = usage?.output_tokens ?? 0;
      cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
      cacheReadTokens = usage?.cache_read_input_tokens ?? 0;

      if (!resultText && message.subtype === "success") {
        resultText = message.result as string;
      }
      if (message.subtype === "error_max_turns") {
        stopReason = "max_tokens";
      }
    }
  }

  res.json({
    id: messageId,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: resultText }],
    model: resolvedModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  });
}

async function handleStreamingPlain(
  req: Request,
  res: Response,
  messageId: string,
  requestedModel: string,
  resolvedModel: string,
  prompt: string
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const { generator } = trackedQuery({
    completionId: messageId,
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
    cancelTask(messageId);
  });

  function writeEvent(eventType: string, data: unknown): void {
    if (clientDisconnected) return;
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    for await (const message of generator) {
      if (clientDisconnected) break;
      if (message.type !== "stream_event") continue;

      const event = message.event as Record<string, unknown> & { type: string };
      const eventType = event.type;

      if (eventType === "message_start") {
        const innerMessage = event.message as
          | (Record<string, unknown> & { id?: string; model?: string })
          | undefined;
        if (innerMessage) {
          writeEvent(eventType, {
            ...event,
            message: { ...innerMessage, id: messageId, model: resolvedModel },
          });
          continue;
        }
      }

      writeEvent(eventType, event);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    writeEvent("error", { type: "error", error: { type: "api_error", message } });
  }

  if (!clientDisconnected) {
    res.end();
  }
}

export default router;
