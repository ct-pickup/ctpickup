/** Staff pickup workflow: derived lifecycle + tab buckets (shared by web admin). */

import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";

export type PickupWorkflowTab = "planning" | "active" | "past";

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

/** True when the run belongs on the Past tab (terminal states only). */
export function isPastTerminalPickupRun(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return true;
  const st = String(row.status || "").trim();
  return st === "completed" || st === "canceled";
}

/** Segmented control bucket for admin pickup list (Planning / Active / Past). */
export function pickupWorkflowTabForRun(row: {
  status?: string | null;
  is_completed?: boolean | null;
}): PickupWorkflowTab {
  if (isPastTerminalPickupRun(row)) return "past";
  const st = String(row.status || "").trim();
  if (st === "planning") return "planning";
  if (st === "likely_on" || st === "active" || st === "in_progress") return "active";
  return "planning";
}

export function defaultPickupWorkflowTab(counts: Record<PickupWorkflowTab, number>): PickupWorkflowTab {
  if (counts.active > 0) return "active";
  if (counts.planning > 0) return "planning";
  return "past";
}

/** True when “Begin Pickup Now” should appear: confirmed (active), not completed, ±1h around kickoff. */
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

/**
 * Finalize kickoff time (pick a slot). Shown while the run is not yet active and no final slot is set.
 * Staff may finalize from planning (manual) or after the run moves to likely_on (poll threshold met).
 */
export function showFinalizeTimeButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
  final_slot_id?: string | null;
}): boolean {
  if (row.is_completed === true) return false;
  const st = String(row.status || "").trim();
  if (st === "canceled" || st === "active" || st === "in_progress" || st === "completed") return false;
  if (row.final_slot_id) return false;
  return st === "likely_on" || st === "planning";
}

/** Promote a planning run to the regional hub (`is_current`). */
export function showPromoteToHubButton(row: {
  status?: string | null;
  is_current?: boolean | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  const st = String(row.status || "").trim();
  if (st === "canceled") return false;
  if (st !== "planning") return false;
  return row.is_current !== true;
}

/** Select runs only; opens tier outreach + invites. */
export function showLaunchOutreachButton(row: {
  status?: string | null;
  run_type?: unknown;
  outreach_started_at?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  if (isPublicPickupRunType(row.run_type)) return false;
  if (row.outreach_started_at) return false;
  const st = String(row.status || "").trim();
  if (st === "canceled" || st === "active" || st === "in_progress" || st === "completed") return false;
  return st === "planning" || st === "likely_on";
}

/** Edit run settings (non-canceled, non-terminal). */
export function showEditSettingsButton(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return false;
  const st = String(row.status || "").trim();
  return st !== "canceled";
}

/** Past / terminal: post results entry point when nothing saved yet. */
export function showPostResultsForPast(row: {
  status?: string | null;
  is_completed?: boolean | null;
  has_result?: boolean | null;
}): boolean {
  if (row.has_result === true) return false;
  return isPastTerminalPickupRun(row);
}

export function showViewResultsForPast(row: { has_result?: boolean | null }): boolean {
  return row.has_result === true;
}

/**
 * @deprecated Prefer {@link showPostResultsForPast} on past runs only. Kept for legacy imports.
 */
export function showPostResultsButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
  has_result?: boolean | null;
}): boolean {
  return showPostResultsForPast(row);
}

/** @deprecated Renamed to {@link showPostResultsButton}. */
export const showMarkResultButton = showPostResultsButton;
