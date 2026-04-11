import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchUiStatus } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";

export function computeWinnerUserId(args: {
  player1UserId: string;
  player2UserId: string;
  scorePlayer1: number;
  scorePlayer2: number;
}): string | null {
  const { player1UserId, player2UserId, scorePlayer1, scorePlayer2 } = args;
  if (scorePlayer1 === scorePlayer2) return null;
  return scorePlayer1 > scorePlayer2 ? player1UserId : player2UserId;
}

/**
 * Maps persisted match status (+ optional open report) to a concise UI label for players.
 * DB uses a single authoritative report row per match plus `esports_matches.status` for workflow.
 */
export function matchWorkflowUiLabel(args: {
  status: EsportsMatchWorkflowStatus;
  report: EsportsMatchReportRow | null;
}): EsportsMatchUiStatus {
  const { status, report } = args;
  if (status === "void") return "void";
  if (status === "forfeit") return "forfeit";
  if (status === "completed") return "finalized";
  if (status === "under_review") return "under_review";
  if (status === "disputed") return "disputed";
  if (status === "scheduled") return "awaiting_report";
  if (status === "awaiting_confirmation") {
    return "awaiting_confirmation";
  }
  return "awaiting_report";
}

export function isTerminalMatchStatus(status: EsportsMatchWorkflowStatus): boolean {
  return status === "completed" || status === "void" || status === "forfeit";
}
