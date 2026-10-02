import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  sentry: [] as unknown[],
  promotions: [] as string[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
  getStripePickup: () => h.stripe,
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown) => {
    h.sentry.push(e);
  },
}));
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/pickup/standing/participationGate", () => ({
  assertPickupStandingAllowsParticipation: async () => ({ ok: true }),
}));
vi.mock("@/lib/pickup/ensureRunInviteLink", () => ({ ensurePickupRunInviteLink: async () => undefined }));
vi.mock("@/lib/pickup/lookupPlayerByIdentifier", () => ({ lookupPickupPlayerByUsernameOrEmail: async () => null }));
vi.mock("@/lib/payments/recordCheckoutStarted", () => ({ recordPlatformCheckoutStarted: async () => undefined }));
vi.mock("@/lib/chat/runBanterRoom", () => ({
  addUserToRunBanterRoom: async () => undefined,
  removeUserFromRunBanterRoom: async () => undefined,
}));
vi.mock("@/lib/pickup/notifyFollowersOnPickupConfirm", () => ({ notifyFollowersWhenFollowedPlayerConfirmsRun: async () => undefined }));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({ sendPickupRsvpConfirmedPush: async () => undefined }));
vi.mock("@/lib/pickup/sessionLifecycle", () => ({ scheduleSessionRateRemindersForRun: async () => undefined }));
vi.mock("@/lib/referral/pickupReferralCredit", () => ({ tryApplyReferralCreditToPickupJoin: async () => ({ applied: false }) }));
vi.mock("@/lib/pickup/waitlist", () => ({
  countAcceptedPickupRsvps: async () => 0,
  deletePendingWaitlistExpiringReminders: async () => undefined,
  promoteNextWaitlistPlayer: async (_admin: unknown, runId: string) => {
    h.promotions.push(runId);
    return { ok: true, promoted_user_id: null };
  },
}));

import { POST as rsvpPOST } from "@/app/api/pickup/rsvp/route";
import { pickupRefundIdempotencyKey } from "@/lib/payments/pickupRefunds";

const RUN = "run-1";
const PLAYER = "player-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function decline(userId = PLAYER) {
  return rsvpPOST(
    new Request("http://test.local/api/pickup/rsvp", {
      method: "POST",
      headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "decline", run_id: RUN }),
    }),
  );
}

function seed(opts: { startInMs?: number; amountReceived?: number; paidAgoMs?: number; payer?: string } = {}) {
  const paidAgoMs = opts.paidAgoMs ?? 2 * HOUR;
  const paidAt = iso(-paidAgoMs);
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    run_type: "public",
    created_by: null,
    final_slot_id: null,
    fee_cents: FEE,
    status: "active",
    start_at: iso(opts.startInMs ?? 72 * HOUR),
  });
  h.db.rows("profiles").push({ id: PLAYER, approved: true, tier_rank: 1, tier: null, is_banned: false });
  h.stripe.addPi("pi_1", opts.amountReceived ?? FEE + 500, { chargeCreatedIso: iso(-paidAgoMs - 60_000) });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN,
    user_id: PLAYER,
    status: "confirmed",
    paid_at: paidAt,
    payment_intent_id: "pi_1",
    checkout_session_id: "cs_1",
    refund_id: null,
  });
  h.db.rows("platform_payments").push({
    id: "pp_1",
    product_type: "pickup",
    product_entity_id: RUN,
    user_id: opts.payer ?? PLAYER,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    lifecycle_status: "payment_received",
    refunded_at: null,
    metadata: opts.payer ? { run_id: RUN, paid_for_user_id: PLAYER } : { run_id: RUN },
    created_at: paidAt,
  });
}

function rsvp() {
  return h.db.rows("pickup_run_rsvps").find((r) => r.user_id === PLAYER)!;
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.sentry = [];
  h.promotions = [];
});

describe("RSVP decline refunds", () => {
  it("refunds what Stripe actually charged (incl. photo package) with a per-RSVP idempotency key", async () => {
    seed();
    const res = await decline();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "canceled", refund: { status: "refunded", amount_cents: FEE + 500 } });
    const refund = [...h.stripe.refundsById.values()][0];
    expect(refund.amount).toBe(FEE + 500);
    expect(h.stripe.idem.has(pickupRefundIdempotencyKey(RUN, PLAYER, "pi_1"))).toBe(true);
    expect(rsvp()).toMatchObject({ status: "canceled", refund_id: refund.id });
    expect(h.db.rows("platform_payments")[0]).toMatchObject({ lifecycle_status: "refunded" });
    expect(h.db.rows("platform_payments")[0].metadata).toMatchObject({ refund_trigger: "player_decline" });
    expect(h.promotions).toEqual([RUN]);
  });

  it("refunds only what remains after an earlier partial refund", async () => {
    seed();
    h.stripe.pis.get("pi_1")!.amount_refunded = 500;
    const body = await (await decline()).json();
    expect(body.refund).toEqual({ status: "refunded", amount_cents: FEE });
  });

  it("a Stripe failure keeps the player confirmed, reports to Sentry and never claims a refund", async () => {
    seed();
    h.stripe.failRefundFor.add("pi_1");
    const res = await decline();
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/not refunded/);
    expect(body.refund).toBeUndefined();
    expect(rsvp().status).toBe("confirmed");
    expect(h.sentry).toHaveLength(1);
    expect(h.promotions).toEqual([]);
  });

  it("a refund Stripe reports as failed is not treated as issued", async () => {
    seed();
    h.stripe.nextRefundStatus = "failed";
    const res = await decline();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/not issued/);
    expect(rsvp().status).toBe("confirmed");
  });

  it("retry after the RSVP update failed does not refund twice", async () => {
    seed();
    h.db.failUpdates.push({ table: "pickup_run_rsvps", message: "db down" });
    const first = await decline();
    expect(first.status).toBe(500);
    expect((await first.json()).error).toMatch(/refund of \$10\.32 was issued/);
    expect(rsvp().status).toBe("confirmed");
    expect(h.sentry.length).toBeGreaterThan(0);

    h.db.failUpdates = [];
    const retry = await decline();
    const body = await retry.json();
    expect(retry.status).toBe(200);
    expect(body.refund).toEqual({ status: "already_refunded", amount_cents: FEE + 500 });
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.stripe.pis.get("pi_1")!.amount_refunded).toBe(FEE + 500);
  });

  it("repeating a decline on an already-canceled RSVP never touches Stripe", async () => {
    seed();
    rsvp().status = "canceled";
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, status: "canceled", refund: null });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("does not refund within the cancellation deadline", async () => {
    seed({ startInMs: 5 * HOUR });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, refund: null });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("does not refund a stale charge that an earlier leave already turned into the payer's credit", async () => {
    seed({ payer: "friend-1", paidAgoMs: 10 * 24 * HOUR });
    rsvp().paid_at = iso(-HOUR);
    h.db.rows("pickup_credits").push({
      id: "old", user_id: "friend-1", amount_cents: FEE + 500, reason: "cancellation", cancelled_run_id: RUN,
      awarded_at: iso(-9 * 24 * HOUR), expires_at: iso(60 * 24 * HOUR), used_at: null, run_id: null,
    });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, refund: null });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("flags an unmatched charge for manual review instead of refunding it", async () => {
    seed({ paidAgoMs: 10 * 24 * HOUR });
    rsvp().paid_at = iso(-HOUR);
    const res = await decline();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/review manually/);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvp().status).toBe("confirmed");
  });
});
