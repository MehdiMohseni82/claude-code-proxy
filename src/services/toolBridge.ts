import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

// ---- Server tool mapping (Anthropic API type → Claude Code built-in name) ----
// Server tools have a versioned `type` field like "web_search_20260209".

const SERVER_TOOL_MAP: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  code_execution: "Bash",
  bash: "Bash",
  text_editor: "Edit",
};

// Detect whether a tool definition is an Anthropic server tool (has versioned type field).
export function isServerTool(tool: Record<string, unknown>): boolean {
  const type = tool.type as string | undefined;
  if (!type) return false;
  // Server tools have type like "web_search_20260209"
  return /^[a-z_]+_\d{8}$/.test(type);
}

// Extract the base name from a versioned server tool type.
// "web_search_20260209" → "web_search"
function serverToolBaseName(type: string): string {
  return type.replace(/_\d{8}$/, "");
}

// Map a server tool to its Claude Code built-in name.
export function mapServerToolToBuiltin(type: string): string | null {
  const base = serverToolBaseName(type);
  return SERVER_TOOL_MAP[base] ?? null;
}
import { z, type ZodTypeAny } from "zod";
import type { ClientTool, OutputBlock, OutputToolUseBlock } from "../types/toolBridge.js";

// Mutable shape used during construction; cast to ZodRawShape when passing to tool().
type MutableZodShape = Record<string, ZodTypeAny>;

// ---- JSON Schema → Zod shape converter (deliberately narrow + permissive) ----

function jsonSchemaPropToZod(schema: unknown): ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  const s = schema as Record<string, unknown>;

  // enum (string) → z.enum
  if (Array.isArray(s.enum)) {
    const vals = s.enum.filter((v): v is string => typeof v === "string");
    if (vals.length > 0 && vals.length === s.enum.length) {
      return z.enum(vals as [string, ...string[]]);
    }
  }

  const type = s.type;
  if (type === "string") return z.string();
  if (type === "number" || type === "integer") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();
  if (type === "array") {
    const item = s.items ? jsonSchemaPropToZod(s.items) : z.any();
    return z.array(item);
  }
  if (type === "object") {
    const props = s.properties as Record<string, unknown> | undefined;
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    if (!props) return z.object({}).passthrough();
    const shape: MutableZodShape = {};
    for (const [k, v] of Object.entries(props)) {
      const zodField = jsonSchemaPropToZod(v);
      shape[k] = required.includes(k) ? zodField : zodField.optional();
    }
    return z.object(shape).passthrough();
  }

  // union-ish — fall through to permissive
  return z.any();
}

function jsonSchemaToZodShape(schema: ClientTool["input_schema"]): MutableZodShape {
  if (!schema || typeof schema !== "object") return {};
  const props = schema.properties as Record<string, unknown> | undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!props || typeof props !== "object") return {};
  const shape: MutableZodShape = {};
  for (const [k, v] of Object.entries(props)) {
    const zodField = jsonSchemaPropToZod(v);
    shape[k] = required.includes(k) ? zodField : zodField.optional();
  }
  return shape;
}

// ---- Name sanitization: MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$ ----

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

// ---- Public API ----

export interface ToolBridge {
  // SDK mcpServers option: { proxy: McpSdkServerConfigWithInstance }
  mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>>;
  // SDK allowedTools option: exact names like "mcp__proxy__get_weather"
  allowedTools: string[];
  // Maps mcp__proxy__X → original client name (e.g., "get_weather")
  mcpToClient: Map<string, string>;
}

export function buildToolBridge(clientTools: ClientTool[]): ToolBridge {
  const mcpToClient = new Map<string, string>();
  const sdkTools = [];
  const usedSanitized = new Set<string>();

  for (const ct of clientTools) {
    const sanitized = sanitizeToolName(ct.name);
    if (usedSanitized.has(sanitized)) {
      throw new Error(
        `Tool name collision after sanitization: '${ct.name}' conflicts with another tool that also maps to '${sanitized}'`
      );
    }
    usedSanitized.add(sanitized);

    const fqn = `mcp__proxy__${sanitized}`;
    mcpToClient.set(fqn, ct.name);

    const shape = jsonSchemaToZodShape(ct.input_schema);

    // The handler is a pure sentinel. Under maxTurns: 1 the SDK won't feed
    // this back to Claude for another turn, so its content doesn't matter.
    // We capture the tool_use block from the assistant message instead.
    const handler = async (_args: Record<string, unknown>) => ({
      content: [
        {
          type: "text" as const,
          text: "__PROXY_INTERCEPTED__",
        },
      ],
      isError: true,
    });

    sdkTools.push(
      tool(sanitized, ct.description ?? "", shape, handler)
    );
  }

  const mcpServer = createSdkMcpServer({
    name: "proxy",
    version: "1.0.0",
    tools: sdkTools,
  });

  return {
    mcpServers: { proxy: mcpServer },
    allowedTools: Array.from(mcpToClient.keys()),
    mcpToClient,
  };
}

// Rewrite every tool_use block in an SDK assistant message content array
// so that mcp__proxy__get_weather → get_weather (the client's original name).
// Also drops blocks we don't support in the client-facing output.
export function rewriteBlocksForClient(
  rawContent: Array<Record<string, unknown>>,
  mcpToClient: Map<string, string>
): OutputBlock[] {
  const out: OutputBlock[] = [];
  for (const block of rawContent) {
    const type = (block as { type?: string }).type;
    if (type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) {
        out.push({ type: "text", text });
      }
    } else if (type === "tool_use") {
      const id = (block as { id?: unknown }).id;
      const name = (block as { name?: unknown }).name;
      const input = (block as { input?: unknown }).input;
      if (typeof id === "string" && typeof name === "string") {
        const clientName = mcpToClient.get(name) ?? name;
        out.push({
          type: "tool_use",
          id,
          name: clientName,
          input: (input && typeof input === "object"
            ? (input as Record<string, unknown>)
            : {}) as Record<string, unknown>,
        });
      }
    }
    // drop thinking, tool_result, server_tool_use, etc.
  }
  return out;
}

// Does a set of output blocks contain any tool_use block?
export function hasToolUse(blocks: OutputBlock[]): blocks is (OutputBlock &
  { type: "tool_use" })[] {
  return blocks.some((b): b is OutputToolUseBlock => b.type === "tool_use");
}
