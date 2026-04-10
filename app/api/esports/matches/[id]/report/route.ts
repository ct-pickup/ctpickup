import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = {
  score_player1?: number;
  score_player2?: number;
  proof_url?: string | null;
};

function mustNonNegInt(label: string, x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || !Number.isInteger(x) || x < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return x;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await supabaseServer();
    const user = await getAuthUserSafe(supabase);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const s1 = mustNonNegInt("Score (player 1)", body.score_player1);
    const s2 = mustNonNegInt("Score (player 2)", body.score_player2);
    const proofUrl = typeof body.proof_url === "string" ? body.proof_url.trim() : null;

    const { data: match, error: mErr } = await supabase
      .from("esports_matches")
      .select("id,player1_user_id,player2_user_id,status")
      .eq("id", matchId)
      .maybeSingle();

    if (mErr) return NextResponse.json({ error: "Could not load match." }, { status: 500 });
    if (!match) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const p1 = String((match as any).player1_user_id);
    const p2 = String((match as any).player2_user_id);
    if (user.id !== p1 && user.id !== p2) {
      return NextResponse.json({ error: "You do not have access to this match." }, { status: 403 });
    }

    if ((match as any).status === "completed") {
      return NextResponse.json({ error: "This match is already completed." }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { error: upErr } = await supabase
      .from("esports_matches")
      .update({
        score_player1: s1,
        score_player2: s2,
        status: "reported",
        updated_at: now,
      })
      .eq("id", matchId);

    if (upErr) return NextResponse.json({ error: "Could not save report." }, { status: 500 });

    const { error: insErr } = await supabase.from("esports_match_results").insert({
      match_id: matchId,
      proof_url: proofUrl || null,
      submitted_by_user_id: user.id,
      submitted_at: now,
      payload: { score_player1: s1, score_player2: s2 },
    });

    if (insErr) {
      // Match score was recorded; proof insert failed. Return ok but include warning.
      return NextResponse.json({ ok: true, warning: "Score saved but proof could not be recorded." });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

