import { NextResponse } from "next/server";
import { ensureTierSessionForRun } from "@/lib/pickup/ensureTierSessionForRun";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Ensure a tier_session exists for a pickup run so peer votes / host scoring work
 * even before the host formally ends the session (or when end-run didn't set one).
 */
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

  const isHost = run.created_by === user.id;
  const isAdmin = !!prof?.is_admin;

  if (!isHost && !isAdmin) {
    const { data: rsvp } = await admin
      .from("pickup_run_rsvps")
      .select("status")
      .eq("run_id", run_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const okStatus = rsvp?.status === "confirmed" || rsvp?.status === "pending_payment";
    if (!okStatus) {
      return NextResponse.json({ error: "Only session members can open rating." }, { status: 403 });
    }
  }

  const ensured = await ensureTierSessionForRun(admin, run, user.id);
  if (!ensured.tier_session_id) {
    return NextResponse.json({ error: ensured.error ?? "Could not open rating." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tier_session_id: ensured.tier_session_id });
}
