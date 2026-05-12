/** Staff pickup workflow (mobile admin). Mirrors website `lib/admin/pickupRunLifecycle`. */

export type PickupWorkflowTab = "upcoming" | "in_progress" | "completed";

export type PickupLifecycleStage =
  | "planning"
  | "hub"
  | "outreach"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "result_recorded";

export function pickupLifecycleStageLabel(stage: PickupLifecycleStage): string {
  switch (stage) {
    case "planning":
      return "Planning";
    case "hub":
      return "Hub";
    case "outreach":
      return "Outreach";
    case "confirmed":
      return "Confirmed";
    case "in_progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "result_recorded":
      return "Result Recorded";
    default:
      return stage;
  }
}

export function derivePickupLifecycleStage(row: {
  status?: string | null;
  is_current?: boolean | null;
  outreach_started_at?: string | null;
  is_completed?: boolean | null;
  has_result?: boolean | null;
}): PickupLifecycleStage {
  if (row.has_result) return "result_recorded";
  if (row.is_completed || String(row.status || "").trim() === "completed") return "completed";
  if (String(row.status || "").trim() === "in_progress") return "in_progress";
  if (String(row.status || "").trim() === "active") return "confirmed";
  if (String(row.status || "").trim() === "likely_on" || row.outreach_started_at) return "outreach";
  if (row.is_current) return "hub";
  return "planning";
}

export function pickupWorkflowTabForRun(row: {
  status?: string | null;
  is_completed?: boolean | null;
}): PickupWorkflowTab {
  if (row.is_completed === true) return "completed";
  const st = String(row.status || "").trim();
  if (st === "in_progress") return "in_progress";
  return "upcoming";
}

export function defaultPickupWorkflowTab(
  counts: Record<PickupWorkflowTab, number>,
): PickupWorkflowTab {
  if (counts.in_progress > 0) return "in_progress";
  if (counts.upcoming > 0) return "upcoming";
  return "completed";
}

export function showStartRunNowButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  const st = String(row.status || "").trim();
  if (st === "in_progress") return false;
  return st === "active";
}

export function showEndRunButton(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return false;
  return String(row.status || "").trim() === "in_progress";
}

/**
 * "Post Results" button. Available once the run is in_progress (so staff can
 * begin entering results immediately after kickoff) and stays available
 * post-completion for edits.
 */
export function showPostResultsButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return true;
  return String(row.status || "").trim() === "in_progress";
}

/** @deprecated Renamed to {@link showPostResultsButton}. Kept as a thin alias for callers still wired up. */
export const showMarkResultButton = showPostResultsButton;
