"use client";

import useSWR from "swr";
import { fetchTasks, cancelTask } from "@/lib/client-api";

export default function TasksPage() {
  const { data, mutate } = useSWR("tasks", () => fetchTasks(), {
    refreshInterval: 3000,
  });

  const tasks = data?.tasks ?? [];

  async function handleCancel(id: string) {
    if (!confirm("Cancel this task?")) return;
    try {
      await cancelTask(id);
      mutate();
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Active Tasks</h2>
        <span className="text-sm text-gray-500">Auto-refreshes every 3s</span>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Task ID</th>
              <th className="px-6 py-3 font-medium">API Key</th>
              <th className="px-6 py-3 font-medium">Model</th>
              <th className="px-6 py-3 font-medium">Prompt</th>
              <th className="px-6 py-3 font-medium">Elapsed</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No active tasks
                </td>
              </tr>
            ) : (
              tasks.map((task: any) => (
                <tr key={task.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-3 font-mono text-xs">{task.id.slice(0, 20)}...</td>
                  <td className="px-6 py-3">{task.api_key_name || "—"}</td>
                  <td className="px-6 py-3 font-mono text-xs">{task.model}</td>
                  <td className="px-6 py-3 max-w-xs truncate text-gray-500">
                    {task.prompt_preview}
                  </td>
                  <td className="px-6 py-3">
                    {formatElapsed(task.elapsed_seconds)}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        task.is_streaming
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {task.is_streaming ? "Stream" : "Batch"}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => handleCancel(task.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
