// Shared types for Anthropic Messages API tool-use support.

// Client-provided tool definition (subset of Anthropic Tool schema we support).
export interface ClientTool {
  name: string;
  description?: string;
  input_schema: {
    type?: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
}

// Client-provided tool_choice
export type ClientToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

// Anthropic-shape content blocks the proxy emits back to the client.
export interface OutputTextBlock {
  type: "text";
  text: string;
}
export interface OutputToolUseBlock {
  type: "tool_use";
  id: string;
  name: string; // rewritten to client tool name (not mcp__proxy__*)
  input: Record<string, unknown>;
}
export type OutputBlock = OutputTextBlock | OutputToolUseBlock;
