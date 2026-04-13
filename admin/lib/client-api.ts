// Client-side API wrapper — calls Next.js server-side API routes that proxy to Express

const BASE = "/admin/api/proxy";

async function clientFetch(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: "Request failed" } }));
    throw new Error(error.error?.message || "Request failed");
  }
  return res;
}

// --- API Keys ---

export async function fetchKeys() {
  const res = await clientFetch("/keys");
  return res.json();
}

export async function createKey(name: string) {
  const res = await clientFetch("/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function revokeKey(id: number) {
  const res = await clientFetch(`/keys/${id}`, { method: "DELETE" });
  return res.json();
}

export async function updateKeyBuiltinTools(id: number, allow: boolean) {
  const res = await clientFetch(`/keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ allow_builtin_tools: allow }),
  });
  return res.json();
}

export async function updateKey(id: number, fields: Record<string, unknown>) {
  const res = await clientFetch(`/keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return res.json();
}

// --- Tasks ---

export async function fetchTasks() {
  const res = await clientFetch("/tasks");
  return res.json();
}

export async function cancelTask(id: string) {
  const res = await clientFetch(`/tasks/${id}/cancel`, { method: "POST" });
  return res.json();
}

// --- History ---

export async function fetchHistory(params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await clientFetch(`/history${query}`);
  return res.json();
}

export async function fetchRequestDetail(id: number) {
  const res = await clientFetch(`/history/${id}`);
  return res.json();
}

export function getExportUrl(format: "csv" | "json", params?: Record<string, string>): string {
  const allParams = { format, ...params };
  const query = `?${new URLSearchParams(allParams).toString()}`;
  return `${BASE}/history/export${query}`;
}

// --- Settings ---

export async function fetchTokenStatus() {
  const res = await clientFetch("/settings/token");
  return res.json();
}

export async function setToken(token: string) {
  const res = await clientFetch("/settings/token", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  return res.json();
}

export async function clearToken() {
  const res = await clientFetch("/settings/token", { method: "DELETE" });
  return res.json();
}

export async function fetchStats(params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await clientFetch(`/history/stats${query}`);
  return res.json();
}
