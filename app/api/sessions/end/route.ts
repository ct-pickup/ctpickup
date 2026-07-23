import { NextResponse } from "next/server";
import { ensureTierSessionForRun } from "@/lib/pickup/ensureTierSessionForRun";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Host (or admin) ends a pickup session and opens the rating / tier_session flow. */
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
    .select("id,title,location_text,start_at,created_by,open_tier_rank,tier_session_id,status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { data: prof } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (run.created_by !== user.id && !prof?.is_admin) {
    return NextResponse.json({ error: "Only the host can end this session." }, { status: 403 });
  }

  if (run.status === "completed") {
    const ensured = await ensureTierSessionForRun(admin, run, user.id);
    return NextResponse.json({
      ok: true,
      run_id,
      tier_session_id: ensured.tier_session_id,
      already_completed: true,
    });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("pickup_runs")
    .update({ status: "completed", updated_at: now })
    .eq("id", run_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const ensured = await ensureTierSessionForRun(
    admin,
    { ...run, tier_session_id: run.tier_session_id },
    user.id,
  );

  if (!ensured.tier_session_id) {
    return NextResponse.json({ error: ensured.error ?? "Ended but rating setup failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, run_id, tier_session_id: ensured.tier_session_id });
}
