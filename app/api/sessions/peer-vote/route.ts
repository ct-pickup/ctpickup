import { NextResponse } from "next/server";
import { ensureTierSessionForRun } from "@/lib/pickup/ensureTierSessionForRun";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Submit peer votes for a pickup run. Creates a linked tier_session when missing
 * (peer_votes.session_id must reference tier_sessions — we use that as the run's
 * rating reference rather than inserting the raw run_id).
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    run_id?: string;
    picks?: unknown;
  };
  const run_id = String(body.run_id ?? "").trim();
  const picks = Array.isArray(body.picks)
    ? body.picks.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];

  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  if (picks.length !== 3) {
    return NextResponse.json({ error: "Exactly 3 vote picks are required." }, { status: 400 });
  }
  if (new Set(picks).size !== 3) {
    return NextResponse.json({ error: "Votes must be three different players." }, { status: 400 });
  }
  if (picks.includes(user.id)) {
    return NextResponse.json({ error: "You cannot vote for yourself." }, { status: 400 });
  }

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id,title,location_text,start_at,created_by,open_tier_rank,tier_session_id,status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (run.created_by === user.id) {
    return NextResponse.json({ error: "Hosts rate players separately." }, { status: 403 });
  }

  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status")
    .eq("run_id", run_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rsvp?.status !== "confirmed" && rsvp?.status !== "pending_payment") {
    return NextResponse.json({ error: "Only joined players can vote." }, { status: 403 });
  }

  // Voting opens once the session has started (or after host marks completed).
  const startMs = run.start_at ? new Date(run.start_at).getTime() : NaN;
  const started = Number.isFinite(startMs) && startMs < Date.now();
  const completed = run.status === "completed";
  if (!started && !completed) {
    return NextResponse.json({ error: "Voting opens after kickoff." }, { status: 403 });
  }

  const ensured = await ensureTierSessionForRun(admin, run, user.id);
  if (!ensured.tier_session_id) {
    return NextResponse.json({ error: ensured.error ?? "Could not open voting." }, { status: 500 });
  }

  const tier_session_id = ensured.tier_session_id;

  const { data: existing } = await admin
    .from("peer_votes")
    .select("voter_id")
    .eq("session_id", tier_session_id)
    .eq("voter_id", user.id)
    .limit(1);

  if ((existing?.length ?? 0) > 0) {
    return NextResponse.json({ ok: true, already_voted: true, tier_session_id });
  }

  const rows = picks.map((votee_id, i) => ({
    session_id: tier_session_id,
    voter_id: user.id,
    votee_id,
    rank: i + 1,
  }));

  const { error: insErr } = await admin.from("peer_votes").insert(rows);
  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json({ ok: true, already_voted: true, tier_session_id });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tier_session_id });
}
