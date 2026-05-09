import RunResultClient from "./RunResultClient";

export default async function AdminRunResultPage({
  searchParams,
}: {
  searchParams: Promise<{ run_id?: string }>;
}) {
  const sp = await searchParams;
  const runId = String(sp.run_id || "").trim();
  return <RunResultClient runId={runId} />;
}
