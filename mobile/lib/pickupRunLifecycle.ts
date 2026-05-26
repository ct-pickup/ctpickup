/** Staff pickup workflow (mobile admin). Mirrors `lib/admin/pickupRunLifecycle.ts`. */

import { isPublicPickupRunType } from "@/lib/pickupRunType";

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

export function isPastTerminalPickupRun(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return true;
  const st = String(row.status || "").trim();
  return st === "completed" || st === "canceled";
}

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

/** Promote while planning or after availability threshold (likely_on). */
export function showPromoteToHubDuringPlanning(row: {
  status?: string | null;
  is_current?: boolean | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  if (row.is_current === true) return false;
  const st = String(row.status || "").trim();
  if (st === "canceled") return false;
  return st === "planning" || st === "likely_on";
}

/** Post results while the run is live (before completed / result saved). */
export function showPostResultsDuringRun(row: {
  status?: string | null;
  is_completed?: boolean | null;
  has_result?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  if (row.has_result === true) return false;
  return String(row.status || "").trim() === "in_progress";
}

/** Begin pickup when RSVP phase is active (staff may start before kickoff window). */
export function showBeginPickupButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  return String(row.status || "").trim() === "active";
}

function isHubOutreachEligibleStatus(st: string): boolean {
  return st === "planning" || st === "likely_on" || st === "active";
}

/** Run is on the regional hub and still in planning / RSVP outreach phase. */
export function showHubOutreachActions(row: {
  is_current?: boolean | null;
  status?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (row.is_completed === true) return false;
  if (row.is_current !== true) return false;
  const st = String(row.status || "").trim();
  if (st === "canceled" || st === "completed" || st === "in_progress") return false;
  return isHubOutreachEligibleStatus(st);
}

/** Select hub run: start or retry tier-1 wave invites (hub promote path). */
export function showLaunchWaveInvitesButton(row: {
  is_current?: boolean | null;
  status?: string | null;
  run_type?: unknown;
  outreach_started_at?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (!showHubOutreachActions(row)) return false;
  if (isPublicPickupRunType(row.run_type)) return false;
  if (row.outreach_started_at) return false;
  return true;
}

/** Select hub run: manual player invites (after wave 1 has started). */
export function showInvitePlayersButton(row: {
  is_current?: boolean | null;
  status?: string | null;
  run_type?: unknown;
  outreach_started_at?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (!showHubOutreachActions(row)) return false;
  if (isPublicPickupRunType(row.run_type)) return false;
  return Boolean(row.outreach_started_at);
}

/** Public hub run: mark outreach / automation phase (tier waves are select-only). */
export function showLaunchOutreachButton(row: {
  is_current?: boolean | null;
  status?: string | null;
  run_type?: unknown;
  outreach_started_at?: string | null;
  is_completed?: boolean | null;
}): boolean {
  if (!showHubOutreachActions(row)) return false;
  if (!isPublicPickupRunType(row.run_type)) return false;
  if (row.outreach_started_at) return false;
  return true;
}

export function showEditSettingsButton(row: { status?: string | null; is_completed?: boolean | null }): boolean {
  if (row.is_completed === true) return false;
  const st = String(row.status || "").trim();
  return st !== "canceled";
}

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

export function showPostResultsButton(row: {
  status?: string | null;
  is_completed?: boolean | null;
  has_result?: boolean | null;
}): boolean {
  return showPostResultsForPast(row);
}

export const showMarkResultButton = showPostResultsButton;
