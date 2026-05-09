/** Staff pickup workflow: derived lifecycle + tab buckets (shared by web admin). */

export type PickupWorkflowTab = "upcoming" | "in_progress" | "completed";

export type PickupLifecycleStage =
  | "planning"
  | "hub"
  | "outreach"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "result_recorded";

const ONE_H_MS = 60 * 60 * 1000;

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

/** Furthest lifecycle step reached for this run (for status pill). */
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

/** Segmented control bucket for admin pickup list. */
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

/** True when “Start Run Now” should appear: confirmed (active), not completed, ±1h around kickoff. */
export function showStartRunNowButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
  start_at?: string | null;
}): boolean {
  if (row.is_completed === true) return false;
  if (String(row.status || "").trim() !== "active") return false;
  const startMs = row.start_at ? Date.parse(String(row.start_at)) : NaN;
  if (!Number.isFinite(startMs)) return false;
  const now = Date.now();
  return now >= startMs - ONE_H_MS && now <= startMs + ONE_H_MS;
}

export function showEndRunButton(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return false;
  return String(row.status || "").trim() === "in_progress";
}

export function showMarkResultButton(row: { is_completed?: boolean | null }): boolean {
  return row.is_completed === true;
}
