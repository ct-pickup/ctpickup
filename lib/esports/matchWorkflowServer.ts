import type { SupabaseClient } from "@supabase/supabase-js";
import { trySupabaseService } from "@/lib/supabase/service";
import {
  DEFAULT_CONFIRMATION_DEADLINE_HOURS,
  ESPORTS_MATCH_PROOFS_BUCKET,
} from "@/lib/esports/matchWorkflowConstants";
import { computeWinnerUserId } from "@/lib/esports/matchWorkflowCore";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsTournamentMatchPolicies } from "@/lib/esports/matchWorkflowTypes";

export function requireEsportsService(): SupabaseClient {
  const svc = trySupabaseService();
  if (!svc) {
    throw new Error("Server is missing Supabase service credentials.");
  }
  return svc;
}

type AuditPayload = Record<string, unknown>;

export async function insertMatchAuditEvent(
  svc: SupabaseClient,
  args: {
    matchId: string;
    actorUserId: string | null;
    eventType: string;
    payload?: AuditPayload;
  },
): Promise<void> {
  const { error } = await svc.from("esports_match_audit_events").insert({
    match_id: args.matchId,
    actor_user_id: args.actorUserId,
    event_type: args.eventType,
    payload: args.payload ?? {},
  });
  if (error) throw new Error(error.message);
}

type MatchRow = {
  id: string;
  tournament_id: string;
  player1_user_id: string;
  player2_user_id: string;
  status: string;
};

export async function loadEsportsTournamentMatchPolicies(
  svc: SupabaseClient,
  tournamentId: string,
): Promise<EsportsTournamentMatchPolicies> {
  const { data } = await svc
    .from("esports_tournaments")
    .select("match_confirmation_deadline_hours, require_match_proof, match_no_response_policy")
    .eq("id", tournamentId)
    .maybeSingle();

  const row = data as {
    match_confirmation_deadline_hours?: number;
    require_match_proof?: boolean;
    match_no_response_policy?: string;
  } | null;

  const n = Number(row?.match_confirmation_deadline_hours);
  const hours =
    !Number.isFinite(n) || n < 1 ? DEFAULT_CONFIRMATION_DEADLINE_HOURS : Math.min(336, Math.max(1, Math.floor(n)));

  const policyRaw = String(row?.match_no_response_policy || "staff_review").trim();
  const match_no_response_policy =
    policyRaw === "auto_finalize_report" ? "auto_finalize_report" : "staff_review";

  return {
    match_confirmation_deadline_hours: hours,
    require_match_proof: Boolean(row?.require_match_proof),
    match_no_response_policy,
  };
}

/** @deprecated Prefer loadEsportsTournamentMatchPolicies — kept for narrow call sites. */
export async function loadTournamentConfirmationHours(
  svc: SupabaseClient,
  tournamentId: string,
): Promise<number> {
  const p = await loadEsportsTournamentMatchPolicies(svc, tournamentId);
  return p.match_confirmation_deadline_hours;
}

export function addHoursIso(isoStart: string, hours: number): string {
  const ms = Date.parse(isoStart);
  const t = Number.isNaN(ms) ? Date.now() : ms;
  return new Date(t + hours * 60 * 60 * 1000).toISOString();
}

async function persistOfficialResultFromReport(
  svc: SupabaseClient,
  match: MatchRow,
  report: EsportsMatchReportRow,
  args: {
    audit: { eventType: string; actorUserId: string | null; payload: AuditPayload };
    resultsPayload: Record<string, unknown>;
  },
): Promise<void> {
  const win = computeWinnerUserId({
    player1UserId: match.player1_user_id,
    player2UserId: match.player2_user_id,
    scorePlayer1: report.score_player1,
    scorePlayer2: report.score_player2,
  });

  const now = new Date().toISOString();
  const { data: updated, error } = await svc
    .from("esports_matches")
    .update({
      status: "completed",
      winner_user_id: win,
      score_player1: report.score_player1,
      score_player2: report.score_player2,
      updated_at: now,
    })
    .eq("id", match.id)
    .eq("status", "awaiting_confirmation")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated?.length) {
    throw new Error("Match is no longer awaiting confirmation; refresh and try again.");
  }

  await insertMatchAuditEvent(svc, {
    matchId: match.id,
    actorUserId: args.audit.actorUserId,
    eventType: args.audit.eventType,
    payload: args.audit.payload,
  });

  await svc.from("esports_match_results").insert({
    match_id: match.id,
    proof_url: report.screenshot_storage_path
      ? `storage:${ESPORTS_MATCH_PROOFS_BUCKET}:${report.screenshot_storage_path}`
      : null,
    submitted_by_user_id: report.reporter_user_id,
    submitted_at: report.submitted_at,
    payload: args.resultsPayload,
  });
}

export async function applyConfirmedResult(
  svc: SupabaseClient,
  args: { match: MatchRow; report: EsportsMatchReportRow; actorUserId: string },
): Promise<void> {
  const { match, report, actorUserId } = args;
  const win = computeWinnerUserId({
    player1UserId: match.player1_user_id,
    player2UserId: match.player2_user_id,
    scorePlayer1: report.score_player1,
    scorePlayer2: report.score_player2,
  });

  await persistOfficialResultFromReport(svc, match, report, {
    audit: {
      eventType: "result_confirmed_by_opponent",
      actorUserId,
      payload: {
        winner_user_id: win,
        score_player1: report.score_player1,
        score_player2: report.score_player2,
      },
    },
    resultsPayload: {
      kind: "confirmed_pair",
      score_player1: report.score_player1,
      score_player2: report.score_player2,
      confirmed_by_user_id: actorUserId,
    },
  });
}

/**
 * If confirmation time has passed with no opponent response, either escalate to staff or
 * auto-finalize using the reporter’s submission (tournament `match_no_response_policy`).
 * Idempotent: only affects awaiting_confirmation + pending report.
 */
export async function maybeEscalateConfirmationDeadline(
  svc: SupabaseClient,
  matchId: string,
): Promise<{ escalated: boolean }> {
  const { data: matchRaw, error: mErr } = await svc
    .from("esports_matches")
    .select("id,tournament_id,player1_user_id,player2_user_id,status")
    .eq("id", matchId)
    .maybeSingle();
  if (mErr || !matchRaw) return { escalated: false };
  const match = matchRaw as MatchRow;
  if (match.status !== "awaiting_confirmation") return { escalated: false };

  const { data: reportRaw } = await svc.from("esports_match_reports").select("*").eq("match_id", matchId).maybeSingle();

  const report = reportRaw as EsportsMatchReportRow | null;
  if (!report || report.opponent_response !== "pending") return { escalated: false };

  const deadlineMs = Date.parse(String(report.confirmation_deadline_at));
  if (Number.isNaN(deadlineMs) || Date.now() <= deadlineMs) return { escalated: false };

  const opponentId =
    report.reporter_user_id === match.player1_user_id ? match.player2_user_id : match.player1_user_id;

  const policies = await loadEsportsTournamentMatchPolicies(svc, match.tournament_id);
  const now = new Date().toISOString();

  if (policies.match_no_response_policy === "auto_finalize_report") {
    const { data: timedRows, error: tuErr } = await svc
      .from("esports_match_reports")
      .update({
        opponent_response: "timed_out",
        responded_at: now,
      })
      .eq("match_id", matchId)
      .eq("opponent_response", "pending")
      .select("id");

    if (tuErr) throw new Error(tuErr.message);
    if (!timedRows || timedRows.length === 0) return { escalated: false };

    const { data: freshReport } = await svc.from("esports_match_reports").select("*").eq("match_id", matchId).maybeSingle();
    const fr = freshReport as EsportsMatchReportRow | null;
    if (!fr) return { escalated: false };

    const win = computeWinnerUserId({
      player1UserId: match.player1_user_id,
      player2UserId: match.player2_user_id,
      scorePlayer1: fr.score_player1,
      scorePlayer2: fr.score_player2,
    });

    await persistOfficialResultFromReport(svc, match, fr, {
      audit: {
        eventType: "result_auto_finalized_no_opponent_response",
        actorUserId: null,
        payload: {
          opponent_user_id: opponentId,
          reporter_user_id: fr.reporter_user_id,
          winner_user_id: win,
          score_player1: fr.score_player1,
          score_player2: fr.score_player2,
          policy: "auto_finalize_report",
        },
      },
      resultsPayload: {
        kind: "auto_finalized_no_response",
        score_player1: fr.score_player1,
        score_player2: fr.score_player2,
        confirmation_deadline_at: fr.confirmation_deadline_at,
      },
    });

    return { escalated: true };
  }

  const { error: upErr } = await svc
    .from("esports_matches")
    .update({ status: "under_review", updated_at: now })
    .eq("id", matchId)
    .eq("status", "awaiting_confirmation");
  if (upErr) throw new Error(upErr.message);

  await insertMatchAuditEvent(svc, {
    matchId,
    actorUserId: null,
    eventType: "confirmation_deadline_expired",
    payload: {
      opponent_user_id: opponentId,
      reporter_user_id: report.reporter_user_id,
      policy: "staff_review",
    },
  });

  return { escalated: true };
}
