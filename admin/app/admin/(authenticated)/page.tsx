import { fetchStats } from "@/lib/api";
import { fetchTasks } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, tasksData] = await Promise.all([
    fetchStats({ from: new Date().toISOString().slice(0, 10) }),
    fetchTasks(),
  ]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Tasks"
          value={tasksData.tasks.length}
          color="blue"
        />
        <StatCard
          label="Requests Today"
          value={stats.total_requests}
          color="gray"
        />
        <StatCard
          label="Tokens Today"
          value={(stats.total_input_tokens + stats.total_output_tokens).toLocaleString()}
          color="purple"
        />
        <StatCard
          label="Cost Today"
          value={`$${stats.total_cost_usd.toFixed(4)}`}
          color="green"
        />
      </div>

      {stats.by_model.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Usage by Model</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Model</th>
                <th className="pb-2">Requests</th>
                <th className="pb-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.by_model.map((m: any) => (
                <tr key={m.model} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{m.model}</td>
                  <td className="py-2">{m.count}</td>
                  <td className="py-2">${m.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.by_status.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Requests by Status</h3>
          <div className="flex gap-4">
            {stats.by_status.map((s: any) => (
              <div
                key={s.status}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-sm"
              >
                <StatusDot status={s.status} />
                <span className="capitalize">{s.status}</span>
                <span className="font-semibold">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "border-blue-500",
    gray: "border-gray-500",
    purple: "border-purple-500",
    green: "border-green-500",
  };

  return (
    <div
      className={`bg-white rounded-xl shadow p-6 border-l-4 ${colorMap[color] || "border-gray-500"}`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    success: "bg-green-500",
    error: "bg-red-500",
    pending: "bg-yellow-500",
    cancelled: "bg-gray-500",
  };

  return (
    <span
      className={`w-2 h-2 rounded-full ${colorMap[status] || "bg-gray-400"}`}
    />
  );
}
