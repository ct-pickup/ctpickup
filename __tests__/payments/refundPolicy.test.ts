import { describe, expect, it } from "vitest";
import { decidePickupRefund, refundWindowOpen, type RefundPolicyInput } from "@/lib/payments/refundPolicy";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const PLAYER = "player-1";
const FRIEND = "friend-1";

function input(overrides: Partial<RefundPolicyInput>): RefundPolicyInput {
  return {
    initiator: "player",
    trigger: "leave",
    kickoffAt: new Date(NOW + 72 * HOUR).toISOString(),
    now: NOW,
    paymentPending: false,
    hasCardCharge: true,
    cardNetCents: 1032,
    creditCoveredCents: 0,
    playerId: PLAYER,
    cardPayerId: PLAYER,
    ...overrides,
  };
}

describe("refundWindowOpen", () => {
  it("is open more than 24h before kickoff and closed at exactly 24h", () => {
    const kickoff = NOW + 24 * HOUR;
    expect(refundWindowOpen({ kickoffAt: kickoff + 1, now: NOW })).toBe(true);
    expect(refundWindowOpen({ kickoffAt: kickoff, now: NOW })).toBe(false);
    expect(refundWindowOpen({ kickoffAt: kickoff - 1, now: NOW })).toBe(false);
  });

  it("is closed without a kickoff, and an explicit cutoff replaces kickoff minus 24h", () => {
    expect(refundWindowOpen({ kickoffAt: null, now: NOW })).toBe(false);
    expect(refundWindowOpen({ kickoffAt: "not a date", now: NOW })).toBe(false);
    expect(refundWindowOpen({ kickoffAt: NOW + 72 * HOUR, refundCutoffAt: NOW - 1, now: NOW })).toBe(false);
    expect(refundWindowOpen({ kickoffAt: null, refundCutoffAt: NOW + 1, now: NOW })).toBe(true);
    expect(refundWindowOpen({ kickoffAt: NOW + 72 * HOUR, refundCutoffAt: null, now: NOW })).toBe(false);
  });
});

describe("decidePickupRefund: host and admin cancel", () => {
  for (const initiator of ["host", "admin"] as const) {
    it(`${initiator}: card portion back to the card even inside 24h, credit portion back as credit`, () => {
      const d = decidePickupRefund(
        input({ initiator, trigger: "run_cancel", kickoffAt: NOW + HOUR, cardNetCents: 266, creditCoveredCents: 266 }),
      );
      expect(d).toEqual({
        kind: "settle",
        reason: "host_or_admin_removal",
        refundToCard: true,
        refundCardCents: 266,
        credits: [{ userId: PLAYER, cents: 266, creditedForUserId: null }],
      });
    });
  }

  it("still refunds to the card when the charge was already fully refunded (helper is idempotent)", () => {
    const d = decidePickupRefund(input({ initiator: "host", trigger: "run_cancel", cardNetCents: 0 }));
    expect(d).toMatchObject({ kind: "settle", refundToCard: true, refundCardCents: 0, credits: [] });
  });

  it("credit-only player gets credit, no card refund", () => {
    const d = decidePickupRefund(
      input({ initiator: "admin", trigger: "run_cancel", hasCardCharge: false, cardNetCents: 0, creditCoveredCents: 532 }),
    );
    expect(d).toEqual({
      kind: "settle",
      reason: "host_or_admin_removal",
      refundToCard: false,
      refundCardCents: 0,
      credits: [{ userId: PLAYER, cents: 532, creditedForUserId: null }],
    });
  });

  it("paid nothing: nothing", () => {
    expect(decidePickupRefund(input({ initiator: "host", trigger: "run_cancel", hasCardCharge: false, cardNetCents: 0 }))).toEqual({
      kind: "none",
      reason: "paid_nothing",
    });
  });

  it("pending payment: cancel the checkout, nothing else", () => {
    expect(decidePickupRefund(input({ initiator: "host", trigger: "run_cancel", paymentPending: true }))).toEqual({
      kind: "cancel_checkout",
      reason: "payment_pending",
    });
  });

  it("rejects a player cancelling a run", () => {
    expect(() => decidePickupRefund(input({ initiator: "player", trigger: "run_cancel" }))).toThrow(/host or an admin/);
  });
});

describe("decidePickupRefund: RSVP decline", () => {
  it("refunds the card net more than 24h out and returns no credit", () => {
    const d = decidePickupRefund(input({ trigger: "rsvp_decline", creditCoveredCents: 266 }));
    expect(d).toEqual({ kind: "settle", reason: "rsvp_decline", refundToCard: true, refundCardCents: 1032, credits: [] });
  });

  it("nothing at exactly 24h before kickoff", () => {
    expect(decidePickupRefund(input({ trigger: "rsvp_decline", kickoffAt: NOW + 24 * HOUR }))).toEqual({
      kind: "none",
      reason: "within_24h",
    });
  });

  it("uses the explicit cutoff (cancellation_deadline for date-only runs)", () => {
    expect(decidePickupRefund(input({ trigger: "rsvp_decline", kickoffAt: null, refundCutoffAt: NOW + HOUR }))).toMatchObject({
      kind: "settle",
    });
  });

  it("no card charge: nothing", () => {
    expect(decidePickupRefund(input({ trigger: "rsvp_decline", hasCardCharge: false, cardNetCents: 0 }))).toEqual({
      kind: "none",
      reason: "paid_nothing",
    });
  });
});

describe("decidePickupRefund: player leave", () => {
  it("more than 24h out: card net and credit-covered portion become one credit for the player", () => {
    const d = decidePickupRefund(input({ cardNetCents: 266, creditCoveredCents: 266 }));
    expect(d).toEqual({
      kind: "settle",
      reason: "player_leave_early",
      refundToCard: false,
      refundCardCents: 0,
      credits: [{ userId: PLAYER, cents: 532, creditedForUserId: null }],
    });
  });

  it("24h boundary: 1ms past is a credit, exactly 24h is nothing", () => {
    expect(decidePickupRefund(input({ kickoffAt: NOW + 24 * HOUR + 1 })).kind).toBe("settle");
    expect(decidePickupRefund(input({ kickoffAt: NOW + 24 * HOUR }))).toEqual({ kind: "none", reason: "within_24h" });
  });

  it("inside 24h: nothing, even with a card charge and credit", () => {
    expect(decidePickupRefund(input({ kickoffAt: NOW + 5 * HOUR, creditCoveredCents: 100 }))).toEqual({
      kind: "none",
      reason: "within_24h",
    });
  });

  it("paid nothing: nothing", () => {
    expect(decidePickupRefund(input({ hasCardCharge: false, cardNetCents: 0 }))).toEqual({ kind: "none", reason: "paid_nothing" });
  });

  it("pending payment: cancel the checkout, nothing else, even inside 24h", () => {
    expect(decidePickupRefund(input({ paymentPending: true, kickoffAt: NOW + HOUR }))).toEqual({
      kind: "cancel_checkout",
      reason: "payment_pending",
    });
  });

  it("friend-paid: card portion credited to the payer for the player's spot, credit portion to the player", () => {
    const d = decidePickupRefund(input({ cardPayerId: FRIEND, cardNetCents: 266, creditCoveredCents: 266 }));
    expect(d).toEqual({
      kind: "settle",
      reason: "player_leave_early",
      refundToCard: false,
      refundCardCents: 0,
      credits: [
        { userId: PLAYER, cents: 266, creditedForUserId: null },
        { userId: FRIEND, cents: 266, creditedForUserId: PLAYER },
      ],
    });
  });

  it("friend-paid with nothing left on the card: only the player's credit portion", () => {
    const d = decidePickupRefund(input({ cardPayerId: FRIEND, cardNetCents: 0, creditCoveredCents: 100 }));
    expect(d).toMatchObject({ kind: "settle", credits: [{ userId: PLAYER, cents: 100, creditedForUserId: null }] });
  });

  it("rejects a host or admin using the leave rule", () => {
    expect(() => decidePickupRefund(input({ initiator: "host" }))).toThrow(/Only the player/);
    expect(() => decidePickupRefund(input({ initiator: "admin" }))).toThrow(/Only the player/);
  });
});
