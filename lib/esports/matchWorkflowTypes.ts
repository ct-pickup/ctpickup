/** DB values for public.esports_matches.status (workflow + terminal). */
export type EsportsMatchWorkflowStatus =
  | "scheduled"
  | "awaiting_confirmation"
  | "disputed"
  | "under_review"
  | "completed"
  | "void"
  | "forfeit";

/** Player-facing label derived from DB status + report row (see matchWorkflowUiLabel). */
export type EsportsMatchUiStatus =
  | "awaiting_report"
  | "awaiting_confirmation"
  | "confirmed"
  | "disputed"
  | "under_review"
  | "finalized"
  | "void"
  | "forfeit";

export type OpponentReportResponse = "pending" | "confirmed" | "disputed" | "timed_out";

/** Tournament-level workflow (see migration `esports_match_policies_and_timeout`). */
export type EsportsMatchNoResponsePolicy = "staff_review" | "auto_finalize_report";

export type EsportsTournamentMatchPolicies = {
  match_confirmation_deadline_hours: number;
  require_match_proof: boolean;
  match_no_response_policy: EsportsMatchNoResponsePolicy;
};

export type EsportsMatchReportRow = {
  id: string;
  match_id: string;
  reporter_user_id: string;
  reported_winner_user_id: string | null;
  score_player1: number;
  score_player2: number;
  screenshot_storage_path: string | null;
  submitted_at: string;
  confirmation_deadline_at: string;
  opponent_response: OpponentReportResponse;
  dispute_reason: string | null;
  responded_at: string | null;
};

export type EsportsConductSeverity = "warning" | "strike" | "forfeit" | "disqualification";
