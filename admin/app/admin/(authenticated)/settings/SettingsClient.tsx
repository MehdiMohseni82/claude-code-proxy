"use client";

import { useState } from "react";
import { fetchTokenStatus, setToken, clearToken } from "@/lib/client-api";

interface TokenStatus {
  configured: boolean;
  source: string;
  preview: string | null;
}

export default function SettingsClient({
  initialTokenStatus,
}: {
  initialTokenStatus: TokenStatus;
}) {
  const [status, setStatus] = useState<TokenStatus>(initialTokenStatus);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSave() {
    if (!tokenInput.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await setToken(tokenInput.trim());
      setStatus({ configured: result.configured, source: result.source, preview: result.preview });
      setTokenInput("");
      setMessage({ type: "success", text: "Token saved successfully." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm("Remove the token from the database? The server will fall back to the environment variable if one is set.")) return;
    setMessage(null);
    try {
      const result = await clearToken();
      setStatus({ configured: result.configured, source: result.source, preview: result.preview });
      setMessage({ type: "success", text: "Token removed from database." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  }

  async function handleRefresh() {
    try {
      const result = await fetchTokenStatus();
      setStatus(result);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      {/* Current Token Status */}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Claude Authentication</h3>
        <p className="text-sm text-gray-500 mb-4">
          The proxy needs a Claude OAuth token (from a Pro/Max subscription) or an Anthropic API key to make requests.
          Configure it here instead of setting environment variables.
        </p>

        <div className="flex items-center gap-3 mb-6">
          <div className={`w-3 h-3 rounded-full ${status.configured ? "bg-green-500" : "bg-red-500"}`} />
          <div>
            <span className="text-sm font-medium">
              {status.configured ? "Token configured" : "No token configured"}
            </span>
            {status.configured && (
              <span className="text-xs text-gray-400 ml-2">
                Source: {status.source} | {status.preview}
              </span>
            )}
          </div>
          <button
            onClick={handleRefresh}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
          >
            Refresh
          </button>
        </div>

        {/* Token Input */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            {status.configured && status.source === "database" ? "Update Token" : "Set Token"}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="sk-ant-oat01-... or sk-ant-api..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !tokenInput.trim()}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          <p className="text-xs text-gray-400">
            Supports OAuth tokens (<code>sk-ant-oat01-...</code>) from <code>claude setup-token</code> or
            standard API keys (<code>sk-ant-api...</code>). The token is stored encrypted in the database.
          </p>
        </div>

        {/* Clear Button */}
        {status.configured && status.source === "database" && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={handleClear}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Remove token from database
            </button>
            <p className="text-xs text-gray-400 mt-1">
              The server will fall back to the CLAUDE_CODE_OAUTH_TOKEN environment variable if set.
            </p>
          </div>
        )}
      </div>

      {/* Token Source Priority */}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Token Priority</h3>
        <p className="text-sm text-gray-500 mb-3">
          The server checks for a valid token in this order:
        </p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-gray-600">
          <li className={status.source === "database" ? "font-semibold text-gray-900" : ""}>
            Database (set via this page)
          </li>
          <li className={status.source === "environment" ? "font-semibold text-gray-900" : ""}>
            <code className="text-xs">CLAUDE_CODE_OAUTH_TOKEN</code> environment variable
          </li>
          <li className={status.source === "environment" ? "font-semibold text-gray-900" : ""}>
            <code className="text-xs">ANTHROPIC_API_KEY</code> environment variable
          </li>
        </ol>
      </div>

      {/* Message */}
      {message && (
        <div className={`rounded-xl p-4 text-sm ${
          message.type === "success"
            ? "bg-green-50 border border-green-200 text-green-800"
            : "bg-red-50 border border-red-200 text-red-800"
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
