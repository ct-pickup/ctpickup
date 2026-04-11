import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import {
  addHoursIso,
  insertMatchAuditEvent,
  loadEsportsTournamentMatchPolicies,
  maybeEscalateConfirmationDeadline,
  requireEsportsService,
} from "@/lib/esports/matchWorkflowServer";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

export const runtime = "nodejs";

type Body = {
  score_player1?: number;
  score_player2?: number;
  /** Storage object path from POST .../proof-upload (private bucket). */
  screenshot_storage_path?: string | null;
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

    const svc = requireEsportsService();

    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const s1 = mustNonNegInt("Score (player 1)", body.score_player1);
    const s2 = mustNonNegInt("Score (player 2)", body.score_player2);
    const proofPath =
      typeof body.screenshot_storage_path === "string" && body.screenshot_storage_path.trim()
        ? body.screenshot_storage_path.trim()
        : null;

    await maybeEscalateConfirmationDeadline(svc, matchId);

    const { data: matchRaw, error: mErr } = await svc
      .from("esports_matches")
      .select(
        "id,tournament_id,player1_user_id,player2_user_id,status,winner_user_id,score_player1,score_player2",
      )
      .eq("id", matchId)
      .maybeSingle();

    if (mErr) return NextResponse.json({ error: "Could not load match." }, { status: 500 });
    if (!matchRaw) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const match = matchRaw as {
      id: string;
      tournament_id: string;
      player1_user_id: string;
      player2_user_id: string;
      status: EsportsMatchWorkflowStatus;
    };

    const p1 = match.player1_user_id;
    const p2 = match.player2_user_id;
    if (user.id !== p1 && user.id !== p2) {
      return NextResponse.json({ error: "You do not have access to this match." }, { status: 403 });
    }

    const terminal: EsportsMatchWorkflowStatus[] = ["completed", "void", "forfeit"];
    if (terminal.includes(match.status)) {
      return NextResponse.json({ error: "This match is already finalized." }, { status: 400 });
    }
    if (match.status === "disputed" || match.status === "under_review") {
      return NextResponse.json(
        { error: "This match is awaiting staff review. You cannot submit a new report yet." },
        { status: 400 },
      );
    }

    const { data: existingReport } = await svc
      .from("esports_match_reports")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();

    const rep = existingReport as EsportsMatchReportRow | null;

    if (match.status === "awaiting_confirmation") {
      if (!rep || rep.opponent_response !== "pending") {
        return NextResponse.json({ error: "A report is already being processed." }, { status: 400 });
      }
      if (rep.reporter_user_id !== user.id) {
        return NextResponse.json(
          { error: "Only the reporting player can update the score while confirmation is pending." },
          { status: 403 },
        );
      }
    } else if (match.status !== "scheduled") {
      return NextResponse.json({ error: "This match cannot be reported right now." }, { status: 400 });
    }

    const policies = await loadEsportsTournamentMatchPolicies(svc, match.tournament_id);
    if (policies.require_match_proof && !proofPath) {
      return NextResponse.json(
        { error: "This tournament requires a score screenshot. Upload proof first, then submit." },
        { status: 400 },
      );
    }

    const win =
      s1 === s2 ? null : s1 > s2 ? p1 : p2;

    const hours = policies.match_confirmation_deadline_hours;
    const now = new Date().toISOString();
    const deadline = addHoursIso(now, hours);

    const reportPayload = {
      match_id: matchId,
      reporter_user_id: user.id,
      reported_winner_user_id: win,
      score_player1: s1,
      score_player2: s2,
      screenshot_storage_path: proofPath,
      submitted_at: now,
      confirmation_deadline_at: deadline,
      opponent_response: "pending" as const,
      dispute_reason: null,
      responded_at: null,
    };

    const { error: repErr } = await svc.from("esports_match_reports").upsert(reportPayload, {
      onConflict: "match_id",
    });
    if (repErr) return NextResponse.json({ error: "Could not save report." }, { status: 500 });

    const { error: upErr } = await svc
      .from("esports_matches")
      .update({
        score_player1: s1,
        score_player2: s2,
        status: "awaiting_confirmation",
        winner_user_id: null,
        updated_at: now,
      })
      .eq("id", matchId);
    if (upErr) return NextResponse.json({ error: "Could not update match." }, { status: 500 });

    await insertMatchAuditEvent(svc, {
      matchId,
      actorUserId: user.id,
      eventType: rep ? "report_updated_by_reporter" : "report_submitted",
      payload: {
        score_player1: s1,
        score_player2: s2,
        confirmation_deadline_at: deadline,
      },
    });

    const { error: legacyErr } = await svc.from("esports_match_results").insert({
      match_id: matchId,
      proof_url: proofPath ? `storage:esports-match-proofs:${proofPath}` : null,
      submitted_by_user_id: user.id,
      submitted_at: now,
      payload: { score_player1: s1, score_player2: s2, phase: "pending_opponent_confirmation" },
    });
    if (legacyErr) {
      return NextResponse.json({
        ok: true,
        warning: "Match saved but legacy result log could not be written.",
        confirmation_deadline_at: deadline,
      });
    }

    return NextResponse.json({ ok: true, confirmation_deadline_at: deadline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
