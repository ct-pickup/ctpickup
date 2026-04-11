import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import {
  applyConfirmedResult,
  maybeEscalateConfirmationDeadline,
  requireEsportsService,
} from "@/lib/esports/matchWorkflowServer";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await supabaseServer();
    const user = await getAuthUserSafe(supabase);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const svc = requireEsportsService();
    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    await maybeEscalateConfirmationDeadline(svc, matchId);

    const { data: matchRaw, error: mErr } = await svc
      .from("esports_matches")
      .select("id,tournament_id,player1_user_id,player2_user_id,status")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr || !matchRaw) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const match = matchRaw as {
      id: string;
      tournament_id: string;
      player1_user_id: string;
      player2_user_id: string;
      status: EsportsMatchWorkflowStatus;
    };

    if (user.id !== match.player1_user_id && user.id !== match.player2_user_id) {
      return NextResponse.json({ error: "You do not have access to this match." }, { status: 403 });
    }

    if (match.status !== "awaiting_confirmation") {
      return NextResponse.json({ error: "This match is not waiting for confirmation." }, { status: 400 });
    }

    const { data: reportRaw, error: rErr } = await svc
      .from("esports_match_reports")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();
    if (rErr || !reportRaw) return NextResponse.json({ error: "No report found for this match." }, { status: 400 });

    const report = reportRaw as EsportsMatchReportRow;
    if (report.opponent_response !== "pending") {
      return NextResponse.json({ error: "This report is no longer pending." }, { status: 400 });
    }

    if (report.reporter_user_id === user.id) {
      return NextResponse.json({ error: "The opponent must confirm this result." }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { error: upRep } = await svc
      .from("esports_match_reports")
      .update({
        opponent_response: "confirmed",
        responded_at: now,
      })
      .eq("id", report.id)
      .eq("opponent_response", "pending");
    if (upRep) return NextResponse.json({ error: "Could not record confirmation." }, { status: 500 });

    await applyConfirmedResult(svc, { match, report, actorUserId: user.id });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
