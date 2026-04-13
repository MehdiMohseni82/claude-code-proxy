import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { registerTask, unregisterTask } from "./taskTracker.js";
import { insertPendingRequest, completeRequest } from "./historyService.js";
import { recordTokensForRateLimit } from "../middleware/rateLimiter.js";
import { invalidateBudgetCache } from "../middleware/budgetCheck.js";
import { getOAuthToken } from "./settingsService.js";

interface TrackedQueryParams {
  completionId: string;
  prompt: string;
  requestedModel: string;
  resolvedModel: string;
  isStreaming: boolean;
  apiKeyId: number | null;
  apiKeyName: string | null;
  includePartialMessages?: boolean;
  // Optional, for tool-use support on /v1/messages:
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  disallowedTools?: string[];
  builtInTools?: string[] | { type: "preset"; preset: "claude_code" };
  systemPrompt?: string;
  maxTurns?: number;
  permissionMode?: string;
  cwd?: string;
}

interface TrackedQueryResult {
  generator: AsyncGenerator<any, void>;
  queryHandle: Query;
}

export function trackedQuery(params: TrackedQueryParams): TrackedQueryResult {
  const startTime = Date.now();

  const promptStr = typeof params.prompt === "string" ? params.prompt : "(multi-modal input)";

  // Insert pending request log (with full prompt for detail view)
  const logId = insertPendingRequest({
    apiKeyId: params.apiKeyId,
    completionId: params.completionId,
    requestedModel: params.requestedModel,
    resolvedModel: params.resolvedModel,
    isStream: params.isStreaming,
    promptPreview: promptStr.slice(0, 200),
    fullPrompt: promptStr,
  });

  // Assemble SDK options. maxTurns defaults to 1 (existing contract); callers
  // may override. settingSources: [] is set unconditionally so Claude Code
  // doesn't load CLAUDE.md or user settings that could leak instructions.
  const sdkOptions: Record<string, unknown> = {
    model: params.resolvedModel,
    maxTurns: params.maxTurns ?? 1,
    settingSources: [],
  };
  if (params.includePartialMessages) sdkOptions.includePartialMessages = true;
  if (params.mcpServers) sdkOptions.mcpServers = params.mcpServers;
  if (params.allowedTools) sdkOptions.allowedTools = params.allowedTools;
  if (params.disallowedTools) sdkOptions.disallowedTools = params.disallowedTools;
  if (params.permissionMode) sdkOptions.permissionMode = params.permissionMode;
  if (params.cwd) sdkOptions.cwd = params.cwd;
  if (params.builtInTools !== undefined) sdkOptions.tools = params.builtInTools;
  if (params.systemPrompt !== undefined) sdkOptions.systemPrompt = params.systemPrompt;

  // Inject the OAuth token from database/env into the SDK subprocess environment.
  // This allows the token to be managed via the admin UI instead of env vars.
  const oauthToken = getOAuthToken();
  if (oauthToken) {
    const env: Record<string, string> = {};
    // Only pass the auth-related env vars to the subprocess, plus PATH
    if (process.env.PATH) env.PATH = process.env.PATH;
    if (process.env.HOME) env.HOME = process.env.HOME;
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
    if (process.env.TEMP) env.TEMP = process.env.TEMP;
    if (process.env.TMP) env.TMP = process.env.TMP;
    // Set the token — auto-detect which env var to use based on prefix
    if (oauthToken.startsWith("sk-ant-oat")) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    } else {
      env.ANTHROPIC_API_KEY = oauthToken;
    }
    sdkOptions.env = env;
  }

  const sdkQuery = query({
    prompt: params.prompt,
    options: sdkOptions,
  });

  // Register active task
  registerTask(
    {
      id: params.completionId,
      model: params.resolvedModel,
      promptPreview: typeof params.prompt === "string" ? params.prompt.slice(0, 200) : "(multi-modal input)",
      apiKeyId: params.apiKeyId,
      apiKeyName: params.apiKeyName,
      startedAt: new Date().toISOString(),
      isStreaming: params.isStreaming,
      requestLogId: logId,
    },
    () => sdkQuery.interrupt()
  );

  // Wrap the generator to handle cleanup and capture full response
  async function* wrappedGenerator() {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCostUsd = 0;
    const responseChunks: string[] = [];

    try {
      for await (const message of sdkQuery) {
        // Capture text from assistant messages for full_response logging
        if (message.type === "assistant") {
          const content = message.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if ((block as { type: string }).type === "text") {
                responseChunks.push((block as { text: string }).text);
              } else if ((block as { type: string }).type === "tool_use") {
                const tu = block as { name?: string; input?: unknown };
                responseChunks.push(`[tool_use: ${tu.name}(${JSON.stringify(tu.input)})]`);
              }
            }
          }
        }
        // Capture usage from result messages
        if (message.type === "result") {
          inputTokens = message.usage?.input_tokens ?? 0;
          outputTokens = message.usage?.output_tokens ?? 0;
          totalCostUsd = message.total_cost_usd ?? 0;
          // Also capture result text if available
          if (message.subtype === "success" && message.result && responseChunks.length === 0) {
            responseChunks.push(message.result as string);
          }
        }
        yield message;
      }

      completeRequest(logId, "success", {
        inputTokens,
        outputTokens,
        totalCostUsd,
        durationMs: Date.now() - startTime,
        fullResponse: responseChunks.join("\n"),
      });

      // Record token usage for rate limiting and invalidate budget cache
      if (params.apiKeyId) {
        recordTokensForRateLimit(params.apiKeyId, inputTokens + outputTokens);
        invalidateBudgetCache(params.apiKeyId);
      }
    } catch (err: any) {
      completeRequest(logId, "error", {
        inputTokens,
        outputTokens,
        totalCostUsd,
        durationMs: Date.now() - startTime,
        errorMessage: err.message ?? "Unknown error",
        fullResponse: responseChunks.length > 0 ? responseChunks.join("\n") : undefined,
      });
      throw err;
    } finally {
      unregisterTask(params.completionId);
    }
  }

  return { generator: wrappedGenerator(), queryHandle: sdkQuery };
}

export function markCancelled(completionId: string, logId: number, startTime: number): void {
  completeRequest(logId, "cancelled", {
    durationMs: Date.now() - startTime,
  });
  unregisterTask(completionId);
}
