import { describe, expect, it, vi } from "vitest";
import { tryApplyPickupCreditToJoin } from "@/lib/pickup/pickupCredits";

function mockCreditsQuery(rows: unknown[] | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return chain;
}

describe("pickup credit application", () => {
  it("does not apply when fee is zero", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() };
    const result = await tryApplyPickupCreditToJoin(admin as never, {
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
    const creditsChain = mockCreditsQuery([]);
    const maybeSingle = vi.fn().mockResolvedValue({ data: { referral_credits: 0 }, error: null });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "pickup_credits") return creditsChain;
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) };
      }),
      rpc: vi.fn(),
    };
    const result = await tryApplyPickupCreditToJoin(admin as never, {
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

  it("returns discount when attendance credit is available", async () => {
    const creditsChain = mockCreditsQuery([
      {
        id: "cred-1",
        user_id: "u1",
        amount_cents: null,
        discount_pct: 20,
        reason: "monthly_attendance",
        awarded_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_at: null,
        run_id: null,
      },
    ]);
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "pickup_credits") return creditsChain;
        return { select: vi.fn(), upsert: vi.fn() };
      }),
      rpc: vi.fn(),
    };
    const result = await tryApplyPickupCreditToJoin(admin as never, {
      payerUserId: "u1",
      targetUserId: "u1",
      runId: "run-1",
      tierAtTime: null,
      feeCents: 1000,
      previousRsvpStatus: "pending_payment",
      hadPendingConfirm: false,
    });
    expect(result).toEqual({
      applied: true,
      kind: "discount",
      creditId: "cred-1",
      discountedFeeCents: 800,
      message: "20% off your next run",
    });
  });

  it("does not apply when legacy consume_referral_credit returns false", async () => {
    const creditsChain = mockCreditsQuery([]);
    const maybeSingle = vi.fn().mockResolvedValue({ data: { referral_credits: 1 }, error: null });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "pickup_credits") return creditsChain;
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) };
      }),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    };
    const result = await tryApplyPickupCreditToJoin(admin as never, {
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
