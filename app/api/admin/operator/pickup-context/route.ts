import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getPickupOperatorContext } from "@/lib/admin/operatorContext";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const runId = String(url.searchParams.get("run_id") || "").trim();
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const runRes = await admin
    .from("pickup_runs")
    .select("id,is_current,status")
    .eq("id", runId)
    .maybeSingle();

  const run = runRes.data as { id: string; is_current?: boolean | null; status?: string | null } | null;
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const bundle = await getPickupOperatorContext(admin, runId, {
    is_current: run.is_current,
    status: run.status,
  });

  return NextResponse.json(bundle);
}
