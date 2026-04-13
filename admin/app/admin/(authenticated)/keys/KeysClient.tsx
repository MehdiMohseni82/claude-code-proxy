"use client";

import { useState } from "react";
import {
  fetchKeys,
  createKey,
  revokeKey,
  updateKey,
} from "@/lib/client-api";

const ALL_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  is_revoked: boolean;
  allow_builtin_tools: boolean;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  monthly_budget_usd: number | null;
  allowed_models: string[] | null;
  system_prompt: string | null;
  cache_ttl_seconds: number | null;
  created_at: string;
  last_used_at: string | null;
}

export default function KeysClient({
  initialKeys,
}: {
  initialKeys: ApiKey[];
}) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await createKey(newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName("");
      const data = await fetchKeys();
      setKeys(data.keys);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number) {
    if (!confirm("Are you sure you want to revoke this key? This cannot be undone.")) return;
    try {
      await revokeKey(id);
      const data = await fetchKeys();
      setKeys(data.keys);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleUpdate(id: number, fields: Record<string, unknown>) {
    try {
      await updateKey(id, fields);
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, ...fields } : k))
      );
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">API Keys</h2>

      {/* Create Key */}
      <div className="mb-6">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            + Create API Key
          </button>
        ) : (
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-xl shadow p-6 flex gap-3 items-end"
          >
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Key Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., cursor-dev, ci-pipeline"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                required
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setCreatedKey(null); }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {/* Created Key Alert */}
      {createdKey && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-medium text-green-800 mb-2">
            API key created! Copy it now — it won't be shown again.
          </p>
          <code className="block bg-white px-3 py-2 rounded border border-green-200 font-mono text-sm break-all select-all">
            {createdKey}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(createdKey)}
            className="mt-2 text-sm text-green-700 hover:text-green-900 underline"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      {/* Keys Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-gray-500">
              <th className="px-4 py-3 font-medium w-8"></th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Key Prefix</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Models</th>
              <th className="px-4 py-3 font-medium">Rate Limit</th>
              <th className="px-4 py-3 font-medium">Budget</th>
              <th className="px-4 py-3 font-medium">Last Used</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-gray-400">
                  No API keys yet. Create one to get started.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <>
                  <tr
                    key={key.id}
                    onClick={() => setExpandedId(expandedId === key.id ? null : key.id)}
                    className={`border-b cursor-pointer transition-colors ${
                      expandedId === key.id ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-400">
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedId === key.id ? "rotate-90" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{key.key_prefix}...</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        key.is_revoked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                      }`}>
                        {key.is_revoked ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {key.allowed_models ? key.allowed_models.length + " models" : "All"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {key.rate_limit_rpm != null ? `${key.rate_limit_rpm} RPM` : "Default"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {key.monthly_budget_usd != null ? `$${key.monthly_budget_usd}` : "Unlimited"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      {!key.is_revoked && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRevoke(key.id); }}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === key.id && (
                    <tr key={`${key.id}-settings`}>
                      <td colSpan={9} className="px-0 py-0">
                        <KeySettings
                          apiKey={key}
                          onUpdate={(fields) => handleUpdate(key.id, fields)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeySettings({
  apiKey,
  onUpdate,
}: {
  apiKey: ApiKey;
  onUpdate: (fields: Record<string, unknown>) => void;
}) {
  const disabled = apiKey.is_revoked;

  return (
    <div className="px-8 py-6 bg-gray-50 border-b space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Built-in Tools Toggle */}
        <SettingCard title="Built-in Tools" description="Allow Claude Code tools (Bash, Read, Edit, etc.)">
          <Toggle
            checked={apiKey.allow_builtin_tools}
            disabled={disabled}
            onChange={(v) => onUpdate({ allow_builtin_tools: v })}
          />
        </SettingCard>

        {/* Rate Limit RPM */}
        <SettingCard title="Rate Limit (RPM)" description="Max requests per minute. Empty = default (30)">
          <NumberInput
            value={apiKey.rate_limit_rpm}
            disabled={disabled}
            placeholder="Default"
            onSave={(v) => onUpdate({ rate_limit_rpm: v })}
          />
        </SettingCard>

        {/* Rate Limit TPM */}
        <SettingCard title="Rate Limit (TPM)" description="Max tokens per minute. Empty = unlimited">
          <NumberInput
            value={apiKey.rate_limit_tpm}
            disabled={disabled}
            placeholder="Unlimited"
            onSave={(v) => onUpdate({ rate_limit_tpm: v })}
          />
        </SettingCard>

        {/* Monthly Budget */}
        <SettingCard title="Monthly Budget (USD)" description="Max spend per month. Empty = unlimited">
          <NumberInput
            value={apiKey.monthly_budget_usd}
            disabled={disabled}
            placeholder="Unlimited"
            step="0.01"
            onSave={(v) => onUpdate({ monthly_budget_usd: v })}
          />
        </SettingCard>

        {/* Allowed Models */}
        <SettingCard title="Allowed Models" description="Restrict to specific models. None selected = all allowed">
          <ModelSelector
            selected={apiKey.allowed_models || []}
            disabled={disabled}
            onChange={(models) => onUpdate({ allowed_models: models.length > 0 ? models : null })}
          />
        </SettingCard>

        {/* Cache TTL */}
        <SettingCard title="Cache TTL (seconds)" description="Cache identical requests. Empty = no caching">
          <NumberInput
            value={apiKey.cache_ttl_seconds}
            disabled={disabled}
            placeholder="No caching"
            onSave={(v) => onUpdate({ cache_ttl_seconds: v })}
          />
        </SettingCard>
      </div>

      {/* System Prompt (full width) */}
      <SettingCard title="System Prompt" description="Prepended to all requests from this key. Empty = none">
        <SystemPromptEditor
          value={apiKey.system_prompt}
          disabled={disabled}
          onSave={(v) => onUpdate({ system_prompt: v })}
        />
      </SettingCard>
    </div>
  );
}

function SettingCard({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-0.5">{title}</label>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      {children}
    </div>
  );
}

function Toggle({ checked, disabled, onChange }: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        disabled ? "bg-gray-200 cursor-not-allowed"
          : checked ? "bg-blue-600 cursor-pointer"
          : "bg-gray-300 cursor-pointer hover:bg-gray-400"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-[22px]" : "translate-x-[3px]"
      }`} />
    </button>
  );
}

function NumberInput({ value, disabled, placeholder, step, onSave }: {
  value: number | null;
  disabled: boolean;
  placeholder: string;
  step?: string;
  onSave: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  if (!editing) {
    return (
      <button
        onClick={() => { if (!disabled) { setDraft(value != null ? String(value) : ""); setEditing(true); } }}
        disabled={disabled}
        className={`px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-full text-left ${
          disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : "hover:bg-white cursor-pointer"
        }`}
      >
        {value != null ? String(value) : <span className="text-gray-400">{placeholder}</span>}
      </button>
    );
  }

  return (
    <div className="flex gap-1">
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        step={step || "1"}
        min="0"
        placeholder={placeholder}
        className="px-3 py-1.5 border border-blue-400 rounded-lg text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = draft.trim() === "" ? null : Number(draft);
            onSave(v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button
        onClick={() => {
          const v = draft.trim() === "" ? null : Number(draft);
          onSave(v);
          setEditing(false);
        }}
        className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs"
      >
        Save
      </button>
      <button
        onClick={() => setEditing(false)}
        className="px-2 py-1 border border-gray-300 rounded-lg text-xs"
      >
        Cancel
      </button>
    </div>
  );
}

function ModelSelector({ selected, disabled, onChange }: {
  selected: string[];
  disabled: boolean;
  onChange: (models: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_MODELS.map((model) => {
        const isSelected = selected.includes(model);
        return (
          <button
            key={model}
            onClick={() => {
              if (disabled) return;
              if (isSelected) {
                onChange(selected.filter((m) => m !== model));
              } else {
                onChange([...selected, model]);
              }
            }}
            disabled={disabled}
            className={`px-2 py-1 rounded-lg text-xs font-mono transition-colors ${
              disabled ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : isSelected ? "bg-blue-100 text-blue-700 border border-blue-300"
                : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
            }`}
          >
            {model.replace("claude-", "")}
          </button>
        );
      })}
    </div>
  );
}

function SystemPromptEditor({ value, disabled, onSave }: {
  value: string | null;
  disabled: boolean;
  onSave: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  if (!editing) {
    return (
      <button
        onClick={() => { if (!disabled) { setDraft(value || ""); setEditing(true); } }}
        disabled={disabled}
        className={`w-full text-left px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[60px] ${
          disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : "hover:bg-white cursor-pointer"
        }`}
      >
        {value ? (
          <span className="text-gray-700 whitespace-pre-wrap">{value.length > 200 ? value.slice(0, 200) + "..." : value}</span>
        ) : (
          <span className="text-gray-400">No system prompt set</span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="Enter a system prompt that will be prepended to all requests from this key..."
        className="w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={() => { onSave(draft.trim() || null); setEditing(false); }}
          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-3 py-1 border border-gray-300 rounded-lg text-xs"
        >
          Cancel
        </button>
        {value && (
          <button
            onClick={() => { onSave(null); setEditing(false); }}
            className="px-3 py-1 text-red-600 text-xs hover:text-red-800"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
