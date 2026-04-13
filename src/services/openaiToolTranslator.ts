// Translates between OpenAI function-calling format and our internal Anthropic
// format, so the /v1/chat/completions endpoint can reuse the same toolBridge
// infrastructure that /v1/messages uses.

import type { ClientTool, OutputBlock } from "../types/toolBridge.js";

// ---- OpenAI request types ----

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ---- Request translation: OpenAI → Anthropic ----

export function openaiToolsToAnthropic(tools: OpenAITool[]): ClientTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

// ---- Response translation: Anthropic → OpenAI ----

// Extract tool calls from Anthropic OutputBlocks → OpenAI tool_calls array.
export function anthropicBlocksToOpenAIToolCalls(
  blocks: OutputBlock[]
): OpenAIToolCall[] | undefined {
  const calls: OpenAIToolCall[] = [];
  for (const block of blocks) {
    if (block.type === "tool_use") {
      calls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }
  return calls.length > 0 ? calls : undefined;
}

// Extract text content from Anthropic OutputBlocks.
export function anthropicBlocksToOpenAIContent(
  blocks: OutputBlock[]
): string | null {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.length > 0) {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join("") : null;
}

// Map Anthropic stop_reason → OpenAI finish_reason.
export function anthropicStopToOpenAI(
  stopReason: string
): "stop" | "tool_calls" | "length" {
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "max_tokens") return "length";
  return "stop";
}

// ---- Multi-turn: translate OpenAI "tool" role messages to Anthropic format ----

// OpenAI uses: { role: "assistant", tool_calls: [...] } then { role: "tool", tool_call_id, content }
// Anthropic uses: { role: "assistant", content: [{ type: "tool_use", ... }] }
//                 { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

export function openaiMessagesToAnthropic(
  messages: Array<Record<string, unknown>>
): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const msg of messages) {
    const role = msg.role as string;

    if (role === "system") {
      // System messages are handled separately; skip here.
      continue;
    }

    if (role === "user") {
      out.push({
        role: "user",
        content: (msg.content as string) ?? "",
      });
      continue;
    }

    if (role === "assistant") {
      const toolCalls = msg.tool_calls as OpenAIToolCall[] | undefined;
      if (toolCalls && toolCalls.length > 0) {
        // Assistant message with tool calls → Anthropic format with tool_use blocks
        const blocks: Array<Record<string, unknown>> = [];
        const text = msg.content as string | null;
        if (text) {
          blocks.push({ type: "text", text });
        }
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({
          role: "assistant",
          content: (msg.content as string) ?? "",
        });
      }
      continue;
    }

    if (role === "tool") {
      // Tool result → Anthropic tool_result in a user message.
      // Multiple consecutive tool messages get merged into one user message.
      const lastMsg = out[out.length - 1];
      const block: Record<string, unknown> = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id as string,
        content: (msg.content as string) ?? "",
      };

      if (
        lastMsg &&
        lastMsg.role === "user" &&
        Array.isArray(lastMsg.content) &&
        lastMsg.content.length > 0 &&
        (lastMsg.content[0] as Record<string, unknown>).type === "tool_result"
      ) {
        // Merge into existing user tool_result message
        (lastMsg.content as Array<Record<string, unknown>>).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    // Unknown roles: pass as user text
    out.push({
      role: "user",
      content: (msg.content as string) ?? "",
    });
  }

  return out;
}
