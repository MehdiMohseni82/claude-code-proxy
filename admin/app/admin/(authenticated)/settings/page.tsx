import { fetchTokenStatus } from "@/lib/api";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tokenStatus = await fetchTokenStatus();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>
      <SettingsClient initialTokenStatus={tokenStatus} />
    </div>
  );
}
