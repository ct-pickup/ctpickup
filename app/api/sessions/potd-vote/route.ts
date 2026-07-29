import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function asUuid(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

/** Cast a single Player of the Day vote for a pickup run. */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const run_id = asUuid(body.run_id);
  const nominee_id = asUuid(body.nominee_id ?? body.potd_nominee ?? body.player_of_the_day);

  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  if (!nominee_id) return NextResponse.json({ error: "nominee_id required" }, { status: 400 });
  if (nominee_id === user.id) {
    return NextResponse.json({ error: "You cannot vote for yourself." }, { status: 403 });
  }

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id,created_by,start_at,status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.created_by === user.id) {
    return NextResponse.json({ error: "Hosts do not cast POTD votes." }, { status: 403 });
  }
  if (nominee_id === run.created_by) {
    return NextResponse.json({ error: "You cannot nominate the host." }, { status: 400 });
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

  const { data: nomineeRsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status")
    .eq("run_id", run_id)
    .eq("user_id", nominee_id)
    .maybeSingle();

  if (nomineeRsvp?.status !== "confirmed" && nomineeRsvp?.status !== "pending_payment") {
    return NextResponse.json({ error: "Nominee must be an attendee." }, { status: 400 });
  }

  const startMs = run.start_at ? new Date(run.start_at).getTime() : NaN;
  const started = Number.isFinite(startMs) && startMs < Date.now();
  const completed = run.status === "completed";
  if (!started && !completed) {
    return NextResponse.json({ error: "Voting opens after kickoff." }, { status: 403 });
  }

  const { data: existing } = await admin
    .from("potd_votes")
    .select("id,nominee_id")
    .eq("run_id", run_id)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      already_voted: true,
      nominee_id: existing.nominee_id,
    });
  }

  const { error: insErr } = await admin.from("potd_votes").insert({
    run_id,
    voter_id: user.id,
    nominee_id,
  });

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json({ ok: true, already_voted: true, nominee_id });
    }
    console.error("[sessions/potd-vote] insert failed", insErr.message);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nominee_id });
}
