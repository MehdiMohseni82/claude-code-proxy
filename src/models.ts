// Shared model mapping between OpenAI-compatible and native Anthropic routes.
// Unknown model names pass through unchanged, so native Claude model IDs also work.

export const MODEL_MAP: Record<string, string> = {
  // OpenAI names → Claude
  "gpt-4o": "claude-sonnet-4-6",
  "gpt-4": "claude-sonnet-4-6",
  "gpt-4-turbo": "claude-sonnet-4-6",
  "gpt-3.5-turbo": "claude-haiku-4-5",
  // Claude names → self (explicit, for clarity)
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5": "claude-haiku-4-5",
  // Embedding models → Ollama (nomic-embed-text)
  "text-embedding-ada-002": "nomic-embed-text",
  "text-embedding-3-small": "nomic-embed-text",
  "text-embedding-3-large": "nomic-embed-text",
  "nomic-embed-text": "nomic-embed-text",
};

export const AVAILABLE_MODELS = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "gpt-4o", name: "GPT-4o (mapped to Claude Sonnet 4.6)" },
  { id: "gpt-4", name: "GPT-4 (mapped to Claude Sonnet 4.6)" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo (mapped to Claude Haiku 4.5)" },
  { id: "nomic-embed-text", name: "Nomic Embed Text (local, via Ollama)" },
  { id: "text-embedding-3-small", name: "text-embedding-3-small (mapped to nomic-embed-text)" },
  { id: "text-embedding-3-large", name: "text-embedding-3-large (mapped to nomic-embed-text)" },
  { id: "text-embedding-ada-002", name: "text-embedding-ada-002 (mapped to nomic-embed-text)" },
];

export function resolveModel(requested: string): string {
  return MODEL_MAP[requested] || requested;
}
