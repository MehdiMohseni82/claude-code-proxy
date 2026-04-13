"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchHistory, fetchRequestDetail, getExportUrl } from "@/lib/client-api";

interface RequestLog {
  id: number;
  api_key_name?: string;
  requested_model: string;
  resolved_model: string;
  is_stream: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
  status: string;
  prompt_preview: string | null;
  created_at: string;
}

interface RequestDetail extends RequestLog {
  full_prompt: string | null;
  full_response: string | null;
  completion_id: string;
  error_message: string | null;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    model: "",
    status: "",
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const limit = 25;

  const loadData = useCallback(async () => {
    const params: Record<string, string> = {
      limit: String(limit),
      offset: String(page * limit),
    };
    if (filters.model) params.model = filters.model;
    if (filters.status) params.status = filters.status;

    const data = await fetchHistory(params);
    setRows(data.rows);
    setTotal(data.total);
  }, [page, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleRow = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const data = await fetchRequestDetail(id);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Request History</h2>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Model
          </label>
          <select
            value={filters.model}
            onChange={(e) => {
              setFilters((f) => ({ ...f, model: e.target.value }));
              setPage(0);
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Models</option>
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Status
          </label>
          <select
            value={filters.status}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value }));
              setPage(0);
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="text-sm text-gray-500">
          {total} total requests
        </div>

        <div className="ml-auto flex gap-2">
          <a
            href={getExportUrl("csv", {
              ...(filters.model ? { model: filters.model } : {}),
              ...(filters.status ? { status: filters.status } : {}),
            })}
            download
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </a>
          <a
            href={getExportUrl("json", {
              ...(filters.model ? { model: filters.model } : {}),
              ...(filters.status ? { status: filters.status } : {}),
            })}
            download
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Export JSON
          </a>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-gray-500">
              <th className="px-4 py-3 font-medium w-8"></th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">API Key</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Prompt</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">In Tokens</th>
              <th className="px-4 py-3 font-medium text-right">Out Tokens</th>
              <th className="px-4 py-3 font-medium text-right">Cost</th>
              <th className="px-4 py-3 font-medium text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  No requests found
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <>
                  <tr
                    key={row.id}
                    onClick={() => toggleRow(row.id)}
                    className={`border-b last:border-0 cursor-pointer transition-colors ${
                      expandedId === row.id
                        ? "bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-400">
                      <svg
                        className={`w-4 h-4 transition-transform ${
                          expandedId === row.id ? "rotate-90" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{row.api_key_name || "---"}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.resolved_model}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-gray-500">
                      {row.prompt_preview || "---"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {row.input_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {row.output_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      ${row.total_cost_usd.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {formatDuration(row.duration_ms)}
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={10} className="px-0 py-0">
                        <DetailPanel
                          detail={detail}
                          loading={loadingDetail}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  detail,
  loading,
}: {
  detail: RequestDetail | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="px-8 py-6 bg-gray-50 border-b text-sm text-gray-400">
        Loading details...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="px-8 py-6 bg-gray-50 border-b text-sm text-gray-400">
        Failed to load details
      </div>
    );
  }

  return (
    <div className="px-8 py-6 bg-gray-50 border-b space-y-4">
      <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
        <div>
          <span className="font-medium text-gray-700">Completion ID: </span>
          <span className="font-mono">{detail.completion_id}</span>
        </div>
        <div>
          <span className="font-medium text-gray-700">Requested Model: </span>
          <span className="font-mono">{detail.requested_model}</span>
        </div>
      </div>

      {detail.error_message && (
        <div>
          <h4 className="text-xs font-medium text-red-700 mb-1">Error</h4>
          <pre className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {detail.error_message}
          </pre>
        </div>
      )}

      <div>
        <h4 className="text-xs font-medium text-gray-700 mb-1">
          Prompt
          {detail.full_prompt
            ? ` (${detail.full_prompt.length.toLocaleString()} chars)`
            : ""}
        </h4>
        <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-800 whitespace-pre-wrap break-words max-h-80 overflow-auto">
          {detail.full_prompt || detail.prompt_preview || "(no prompt recorded)"}
        </pre>
      </div>

      <div>
        <h4 className="text-xs font-medium text-gray-700 mb-1">
          Response
          {detail.full_response
            ? ` (${detail.full_response.length.toLocaleString()} chars)`
            : ""}
        </h4>
        <pre className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-800 whitespace-pre-wrap break-words max-h-80 overflow-auto">
          {detail.full_response || "(no response recorded)"}
        </pre>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    pending: "bg-yellow-100 text-yellow-700",
    cancelled: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
