import { isPublicPickupRunType, isSelectPickupRunType } from "@/lib/pickup/pickupRunType";

export type InlinePlanningPollGateInput = {
  loading: boolean;
  error: string | null;
  run: Record<string, unknown> | null;
  listRunStatus: string;
  listRunType: string | null;
  listFinalSlotId: string | null;
  canParticipateInPlanning: boolean;
  approved: boolean;
  hasDeclinedAvailability: boolean;
};

export type InlinePlanningPollGateResult = {
  showPoll: boolean;
  reason: string;
};

/**
 * Why the inline availability poll is shown or hidden on the Runs list.
 * `reason` is stable for diagnostics when `showPoll` is false.
 */
export function evaluateInlinePlanningPollGate(
  input: InlinePlanningPollGateInput,
): InlinePlanningPollGateResult {
  if (input.loading && !input.run) {
    return { showPoll: false, reason: "loading" };
  }
  if (input.error) {
    return { showPoll: false, reason: "load_error" };
  }
  if (!input.loading && !input.run && !input.error) {
    return { showPoll: false, reason: "run_payload_missing" };
  }
  if (!input.run) {
    return { showPoll: false, reason: "no_run" };
  }

  const runType = input.run.run_type ?? input.listRunType;
  const isPublicRun = isPublicPickupRunType(runType);
  const isSelectRun = isSelectPickupRunType(runType);

  if (!isPublicRun && !isSelectRun) {
    return { showPoll: false, reason: "unknown_run_type" };
  }

  if (!input.canParticipateInPlanning) {
    if (isSelectPickupRunType(input.listRunType)) {
      return { showPoll: false, reason: "select_not_invited" };
    }
    if (isPublicPickupRunType(input.listRunType) && !input.approved) {
      return { showPoll: false, reason: "public_not_approved" };
    }
    return { showPoll: false, reason: "cannot_participate" };
  }

  const runStatus = typeof input.run.status === "string" ? input.run.status : input.listRunStatus;
  if (runStatus !== "planning" && runStatus !== "likely_on") {
    return { showPoll: false, reason: "run_not_in_planning_phase" };
  }

  const finalSlotId = input.run.final_slot_id ?? input.listFinalSlotId;
  if (finalSlotId != null && String(finalSlotId).trim() !== "") {
    return { showPoll: false, reason: "slot_finalized" };
  }

  if (input.hasDeclinedAvailability) {
    return { showPoll: false, reason: "player_declined" };
  }

  return { showPoll: true, reason: "ok" };
}
