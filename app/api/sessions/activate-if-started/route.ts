import { NextResponse } from "next/server";
import {
  promotePlanningRunsPastStart,
  scheduleSessionRateRemindersForRun,
} from "@/lib/pickup/sessionLifecycle";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Promote a planning run to active once start_at has passed (host or member). */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { run_id?: string };
  const run_id = String(body.run_id ?? "").trim();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id,status,start_at,created_by")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { updated } = await promotePlanningRunsPastStart(admin, { runId: run_id });
  await scheduleSessionRateRemindersForRun(admin, run_id);

  const { data: fresh } = await admin
    .from("pickup_runs")
    .select("id,status,start_at")
    .eq("id", run_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    updated,
    status: fresh?.status ?? run.status,
  });
}
