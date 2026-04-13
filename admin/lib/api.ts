const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://localhost:3456";
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || "";

async function adminFetch(path: string, options?: RequestInit): Promise<Response> {
  const url = `${INTERNAL_API_URL}/api/admin${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_API_SECRET}`,
      ...options?.headers,
    },
    cache: "no-store",
  });
}

// --- API Keys ---

export async function fetchKeys() {
  const res = await adminFetch("/keys");
  if (!res.ok) throw new Error("Failed to fetch keys");
  return res.json();
}

export async function createKey(name: string) {
  const res = await adminFetch("/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create key");
  return res.json();
}

export async function revokeKey(id: number) {
  const res = await adminFetch(`/keys/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to revoke key");
  return res.json();
}

// --- Tasks ---

export async function fetchTasks() {
  const res = await adminFetch("/tasks");
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export async function cancelTask(id: string) {
  const res = await adminFetch(`/tasks/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to cancel task");
  return res.json();
}

// --- History ---

export async function fetchHistory(params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await adminFetch(`/history${query}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

// --- Settings ---

export async function fetchTokenStatus() {
  const res = await adminFetch("/settings/token");
  if (!res.ok) throw new Error("Failed to fetch token status");
  return res.json();
}

export async function fetchStats(params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await adminFetch(`/history/stats${query}`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}
