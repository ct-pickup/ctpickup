import { NextResponse } from "next/server";
import { autoSettleTierSession } from "@/lib/pickup/autoSettleSession";
import { ensureTierSessionForRun } from "@/lib/pickup/ensureTierSessionForRun";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

const TIER_TO_SCORE: Record<string, number> = {
  bronze: 2,
  silver: 4,
  gold: 6,
  platinum: 8,
  diamond: 10,
};

/**
 * Host submits organizer tier scores and settles the linked tier_session.
 * Uses the service role because session_attendance has no client UPDATE policy.
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
    tier_session_id?: string | null;
    scores?: Record<string, string>;
  };

  const run_id = String(body.run_id ?? "").trim();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const scoresIn = body.scores && typeof body.scores === "object" ? body.scores : {};
  const entries = Object.entries(scoresIn)
    .map(([user_id, tier]) => ({
      user_id: String(user_id).trim(),
      tier: String(tier ?? "").trim().toLowerCase(),
    }))
    .filter((e) => e.user_id && TIER_TO_SCORE[e.tier] != null);

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
    return NextResponse.json({ error: "Only the host can score players." }, { status: 403 });
  }

  let tier_session_id =
    (typeof body.tier_session_id === "string" && body.tier_session_id.trim()) ||
    (typeof run.tier_session_id === "string" ? run.tier_session_id : null);

  if (!tier_session_id) {
    const ensured = await ensureTierSessionForRun(admin, run, user.id);
    tier_session_id = ensured.tier_session_id;
    if (!tier_session_id) {
      return NextResponse.json({ error: ensured.error ?? "Could not create tier session." }, { status: 500 });
    }
  }

  await ensureTierSessionForRun(admin, { ...run, tier_session_id }, user.id);

  // Neutral defaults for anyone the host didn't score, then apply overrides.
  await admin
    .from("session_attendance")
    .update({ organizer_score: 5 })
    .eq("session_id", tier_session_id)
    .eq("status", "attended")
    .is("organizer_score", null);

  const updateResults: Array<{
    user_id: string;
    score: number;
    error?: string;
    rows?: number;
  }> = [];

  for (const { user_id, tier } of entries) {
    const score = TIER_TO_SCORE[tier]!;
    const { data, error } = await admin
      .from("session_attendance")
      .update({ organizer_score: score })
      .eq("session_id", tier_session_id)
      .eq("user_id", user_id)
      .select("user_id");

    updateResults.push({
      user_id,
      score,
      error: error?.message,
      rows: data?.length ?? 0,
    });
  }

  const settle = await autoSettleTierSession(admin, tier_session_id);

  return NextResponse.json({
    ok: true,
    tier_session_id,
    scores_saved: true,
    settled: settle.settled || Boolean(settle.already_settled),
    already_settled: settle.already_settled ?? false,
    settle_error: settle.error ?? null,
    updateResults,
  });
}
