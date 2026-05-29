import { describe, expect, it } from "vitest";
import { evaluateInlinePlanningPollGate } from "../../mobile/lib/pickup/inlinePlanningPollGate";

const baseRun = {
  id: "run-1",
  status: "planning",
  run_type: "public",
  final_slot_id: null,
  pickup_run_time_slots: [{ id: "s1" }],
};

describe("evaluateInlinePlanningPollGate", () => {
  it("shows poll when participation and slots are ok", () => {
    const r = evaluateInlinePlanningPollGate({
      loading: false,
      error: null,
      run: baseRun,
      listRunStatus: "planning",
      listRunType: "public",
      listFinalSlotId: null,
      canParticipateInPlanning: true,
      approved: true,
      hasDeclinedAvailability: false,
    });
    expect(r.showPoll).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("hides poll when cannot participate", () => {
    const r = evaluateInlinePlanningPollGate({
      loading: false,
      error: null,
      run: baseRun,
      listRunStatus: "planning",
      listRunType: "public",
      listFinalSlotId: null,
      canParticipateInPlanning: false,
      approved: true,
      hasDeclinedAvailability: false,
    });
    expect(r.showPoll).toBe(false);
    expect(r.reason).toBe("cannot_participate");
  });

  it("still shows poll when run has no slot rows (AvailabilityPoll uses defaults)", () => {
    const r = evaluateInlinePlanningPollGate({
      loading: false,
      error: null,
      run: { ...baseRun, pickup_run_time_slots: [] },
      listRunStatus: "planning",
      listRunType: "public",
      listFinalSlotId: null,
      canParticipateInPlanning: true,
      approved: true,
      hasDeclinedAvailability: false,
    });
    expect(r.showPoll).toBe(true);
    expect(r.reason).toBe("ok");
  });
});
