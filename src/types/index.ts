export interface ApiKey {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  is_revoked: number;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  allow_builtin_tools: number;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  monthly_budget_usd: number | null;
  allowed_models: string | null; // JSON array stored as text
  system_prompt: string | null;
  cache_ttl_seconds: number | null;
}

export interface ApiKeyPublic {
  id: number;
  name: string;
  key_prefix: string;
  is_revoked: boolean;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  allow_builtin_tools: boolean;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  monthly_budget_usd: number | null;
  allowed_models: string[] | null;
  system_prompt: string | null;
  cache_ttl_seconds: number | null;
}

export interface ApiKeyCreateResult {
  id: number;
  name: string;
  key: string; // raw key, shown only once
  key_prefix: string;
  created_at: string;
}

export interface RequestLog {
  id: number;
  api_key_id: number | null;
  completion_id: string;
  requested_model: string;
  resolved_model: string;
  is_stream: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
  status: "pending" | "success" | "error" | "cancelled";
  error_message: string | null;
  prompt_preview: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ActiveTask {
  id: string; // completionId (chatcmpl-*)
  model: string;
  promptPreview: string;
  apiKeyId: number | null;
  apiKeyName: string | null;
  startedAt: string;
  isStreaming: boolean;
  requestLogId: number;
}

export interface ActiveTaskResponse {
  id: string;
  model: string;
  prompt_preview: string;
  api_key_name: string | null;
  started_at: string;
  elapsed_seconds: number;
  is_streaming: boolean;
}

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  api_key_id?: number;
  model?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface HistoryStats {
  total_requests: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_model: Array<{
    model: string;
    count: number;
    cost_usd: number;
  }>;
  by_status: Array<{
    status: string;
    count: number;
  }>;
}
