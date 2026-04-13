import { fetchKeys } from "@/lib/api";
import KeysClient from "./KeysClient";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const data = await fetchKeys();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">API Keys</h2>
      <KeysClient initialKeys={data.keys} />
    </div>
  );
}
