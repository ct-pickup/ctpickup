import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import {
  insertMatchAuditEvent,
  maybeEscalateConfirmationDeadline,
  requireEsportsService,
} from "@/lib/esports/matchWorkflowServer";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

export const runtime = "nodejs";

type Body = { reason?: string | null };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await supabaseServer();
    const user = await getAuthUserSafe(supabase);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const svc = requireEsportsService();
    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null;

    await maybeEscalateConfirmationDeadline(svc, matchId);

    const { data: matchRaw, error: mErr } = await svc
      .from("esports_matches")
      .select("id,player1_user_id,player2_user_id,status")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr || !matchRaw) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const match = matchRaw as {
      id: string;
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

    const { data: reportRaw } = await svc.from("esports_match_reports").select("*").eq("match_id", matchId).maybeSingle();
    if (!reportRaw) return NextResponse.json({ error: "No report found." }, { status: 400 });

    const report = reportRaw as EsportsMatchReportRow;
    if (report.opponent_response !== "pending") {
      return NextResponse.json({ error: "This report is no longer pending." }, { status: 400 });
    }
    if (report.reporter_user_id === user.id) {
      return NextResponse.json({ error: "The opponent must dispute or confirm." }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { error: upRep } = await svc
      .from("esports_match_reports")
      .update({
        opponent_response: "disputed",
        dispute_reason: reason,
        responded_at: now,
      })
      .eq("id", report.id);

    if (upRep) return NextResponse.json({ error: "Could not record dispute." }, { status: 500 });

    const { error: upM } = await svc
      .from("esports_matches")
      .update({
        status: "disputed",
        winner_user_id: null,
        updated_at: now,
      })
      .eq("id", matchId);
    if (upM) return NextResponse.json({ error: "Could not update match." }, { status: 500 });

    await insertMatchAuditEvent(svc, {
      matchId,
      actorUserId: user.id,
      eventType: "result_disputed_by_opponent",
      payload: { reason },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
