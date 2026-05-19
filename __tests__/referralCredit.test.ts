import { describe, expect, it, vi } from "vitest";
import { tryApplyReferralCreditToPickupJoin } from "@/lib/referral/pickupReferralCredit";

describe("referral credit application", () => {
  it("does not apply when fee is zero", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() };
    const result = await tryApplyReferralCreditToPickupJoin(admin as never, {
      payerUserId: "u1",
      targetUserId: "u1",
      runId: "run-1",
      tierAtTime: null,
      feeCents: 0,
      previousRsvpStatus: "pending_confirm",
      hadPendingConfirm: true,
    });
    expect(result).toEqual({ applied: false });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not apply when user has no credits", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { referral_credits: 0 }, error: null });
    const admin = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc: vi.fn(),
    };
    const result = await tryApplyReferralCreditToPickupJoin(admin as never, {
      payerUserId: "u1",
      targetUserId: "u1",
      runId: "run-1",
      tierAtTime: null,
      feeCents: 1500,
      previousRsvpStatus: "pending_payment",
      hadPendingConfirm: false,
    });
    expect(result).toEqual({ applied: false });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("does not apply when consume_referral_credit returns false", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { referral_credits: 1 }, error: null });
    const admin = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    };
    const result = await tryApplyReferralCreditToPickupJoin(admin as never, {
      payerUserId: "u1",
      targetUserId: "u1",
      runId: "run-1",
      tierAtTime: null,
      feeCents: 1500,
      previousRsvpStatus: "pending_payment",
      hadPendingConfirm: false,
    });
    expect(result).toEqual({ applied: false });
  });
});
