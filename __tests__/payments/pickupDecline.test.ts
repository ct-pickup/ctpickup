import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  sentry: [] as unknown[],
  promotions: [] as string[],
  pushes: [] as { userIds: string[]; title: string; body: string }[],
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
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, userIds: string[], msg: { title: string; body: string }) => {
    h.pushes.push({ userIds, title: msg.title, body: msg.body });
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
import { POST as leavePOST } from "@/app/api/sessions/leave/route";

const RUN = "run-1";
const PLAYER = "player-1";
const FRIEND = "friend-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function decline(extra: Record<string, unknown> = {}) {
  return rsvpPOST(
    new Request("http://test.local/api/pickup/rsvp", {
      method: "POST",
      headers: { authorization: `Bearer ${PLAYER}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "decline", run_id: RUN, ...extra }),
    }),
  );
}

function leave() {
  return leavePOST(
    new Request("http://test.local/api/sessions/leave", {
      method: "POST",
      headers: { authorization: `Bearer ${PLAYER}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN }),
    }),
  );
}

function seedRun(startInMs = 72 * HOUR) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    run_type: "public",
    created_by: null,
    final_slot_id: null,
    fee_cents: FEE,
    status: "active",
    start_at: iso(startInMs),
  });
  h.db.rows("profiles").push({ id: PLAYER, approved: true, tier_rank: 1, tier: null, is_banned: false, first_name: "Pat", last_name: "Player" });
}

function seedPaid(opts: { startInMs?: number; amountReceived?: number; payer?: string } = {}) {
  seedRun(opts.startInMs);
  const paidAt = iso(-2 * HOUR);
  h.stripe.addPi("pi_1", opts.amountReceived ?? FEE + 500, { chargeCreatedIso: iso(-2 * HOUR - 60_000) });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN,
    user_id: PLAYER,
    status: "confirmed",
    paid_at: paidAt,
    payment_intent_id: "pi_1",
    checkout_session_id: "cs_1",
    refund_id: null,
  });
  if (opts.payer) h.db.rows("profiles").push({ id: opts.payer, first_name: "Fran", last_name: "Friend" });
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
function cancellationCredits(userId: string) {
  return h.db.rows("pickup_credits").filter((c) => c.user_id === userId && c.reason === "cancellation");
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.sentry = [];
  h.promotions = [];
  h.pushes = [];
});

describe("decline without money", () => {
  it("turning down an invite just records the decline", async () => {
    seedRun();
    const res = await decline();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "declined" });
    expect(rsvp().status).toBe("declined");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(h.promotions).toEqual([]);
  });

  it("leaving the waitlist cancels the RSVP with no money moved", async () => {
    seedRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "waitlist", waitlist_position: 3 });
    const body = await (await decline()).json();
    expect(body).toEqual({ ok: true, status: "canceled" });
    expect(rsvp()).toMatchObject({ status: "canceled", waitlist_position: null });
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });
});

describe("decline with a pending payment", () => {
  it("expires the open checkout, frees the spot, no credit, same as leave", async () => {
    seedRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "pending_payment", checkout_session_id: "cs_open" });
    h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
    h.db.rows("platform_payments").push({
      id: "pp_open", product_type: "pickup", product_entity_id: RUN, user_id: PLAYER,
      stripe_checkout_session_id: "cs_open", stripe_payment_intent_id: null, lifecycle_status: "checkout_started", metadata: {},
    });

    const res = await decline();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "canceled", payment_cancelled: true, credit_issued: false });
    expect(body.message).toBe("You left Tuesday Run. Your unfinished payment was cancelled and you were not charged.");
    expect(h.stripe.sessions.get("cs_open")!.status).toBe("expired");
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("checkout_expired");
    expect(rsvp().status).toBe("canceled");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(h.promotions).toEqual([RUN]);
  });

  it("cancels an unfinished PaymentIntent with no checkout session", async () => {
    seedRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "pending_payment", payment_intent_id: "pi_wait" });
    h.stripe.addPi("pi_wait", 0, { status: "requires_payment_method" });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, payment_cancelled: true, credit_issued: false });
    expect(h.stripe.calls.piCancel).toBe(1);
  });
});

describe("decline of a confirmed, paid spot follows leave", () => {
  it("more than 24h out: credit for what Stripe actually charged, never a card refund", async () => {
    seedPaid();
    const res = await decline();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "canceled", credit_issued: true, amount_cents: FEE + 500 });
    expect(body.message).toBe("You left Tuesday Run. A credit of $10.32 has been added to your account.");
    expect(body.refund).toBeUndefined();
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(cancellationCredits(PLAYER)[0]).toMatchObject({ amount_cents: FEE + 500, cancelled_run_id: RUN });
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("payment_received");
    expect(rsvp().status).toBe("canceled");
    expect(h.promotions).toEqual([RUN]);
  });

  it("credits only what remains after an earlier partial refund", async () => {
    seedPaid();
    h.stripe.pis.get("pi_1")!.amount_refunded = 500;
    const body = await (await decline()).json();
    expect(body).toMatchObject({ credit_issued: true, amount_cents: FEE });
  });

  it("inside 24h: nothing back, and says so", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, paid_but_late: true });
    expect(body.message).toBe("You left Tuesday Run. No refund or credit applies within 24 hours of kickoff.");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("friend-paid: the credit goes to the payer for this player's spot", async () => {
    seedPaid({ payer: FRIEND, amountReceived: FEE });
    const body = await (await decline()).json();
    expect(body).toMatchObject({
      ok: true, credit_issued: false, payer_credited: true, payer_credit_cents: FEE, payer_name: "Fran Friend",
    });
    expect(cancellationCredits(PLAYER)).toHaveLength(0);
    expect(cancellationCredits(FRIEND)[0]).toMatchObject({ amount_cents: FEE, credited_for_user_id: PLAYER });
    expect(h.pushes.find((p) => p.userIds.includes(FRIEND))).toMatchObject({ title: "Credit added" });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("friend-paid before the credited_for migration: flagged for review, payer never told it was added", async () => {
    h.db.beforeCreditedForMigration();
    seedPaid({ payer: FRIEND, amountReceived: FEE });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, payer_credited: false, payer_credit_needs_review: true });
    expect(body.warnings[0]).toMatch(/must be credited manually/);
    expect(cancellationCredits(FRIEND)).toHaveLength(0);
    expect(h.sentry).toHaveLength(1);
    expect(h.pushes.find((p) => p.userIds.includes(FRIEND))).toMatchObject({ title: "Credit on its way" });
  });

  it("a double decline issues no second credit", async () => {
    seedPaid();
    await decline();
    const again = await decline();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, status: "canceled" });
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("decline after leave (or leave after decline) credits once", async () => {
    seedPaid();
    await leave();
    await decline();
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
  });

  it("an existing credit for this run is not duplicated when the player re-declines from confirmed", async () => {
    seedPaid();
    h.db.rows("pickup_credits").push({
      id: "existing", user_id: PLAYER, amount_cents: FEE, reason: "cancellation", cancelled_run_id: RUN,
      awarded_at: iso(-60_000), expires_at: iso(90 * 24 * HOUR), used_at: null, run_id: null,
    });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, already_credited: true });
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
  });

  it("a Stripe outage keeps the player confirmed and reports the error", async () => {
    seedPaid();
    h.stripe.pis.delete("pi_1");
    const res = await decline();
    expect(res.status).toBe(502);
    expect(rsvp().status).toBe("confirmed");
    expect(h.sentry).toHaveLength(1);
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("an unmatched charge is not credited and the player stays in", async () => {
    seedPaid();
    rsvp().paid_at = iso(-HOUR);
    h.stripe.addPi("pi_1", FEE, { chargeCreatedIso: iso(-10 * 24 * HOUR) });
    const res = await decline();
    expect(res.status).toBe(502);
    expect(rsvp().status).toBe("confirmed");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });
});

describe("decline preview", () => {
  it("shows the credit amount without changing anything", async () => {
    seedPaid();
    const body = await (await decline({ preview: true })).json();
    expect(body).toEqual({
      ok: true,
      preview: { credit_cents: FEE + 500, payer_credit_cents: 0, payment_cancelled: false, paid_but_late: false, message: "You'll get a $10.32 credit." },
    });
    expect(rsvp().status).toBe("confirmed");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("inside 24h says no refund", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    const body = await (await decline({ preview: true })).json();
    expect(body.preview).toMatchObject({ paid_but_late: true, message: "No refund or credit applies within 24 hours of kickoff." });
  });

  it("friend-paid names the payer", async () => {
    seedPaid({ payer: FRIEND, amountReceived: FEE });
    const body = await (await decline({ preview: true })).json();
    expect(body.preview.message).toBe("Fran Friend paid for your spot, so the $5.32 credit will go to them.");
  });

  it("pending payment is not expired by a preview", async () => {
    seedRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "pending_payment", checkout_session_id: "cs_open" });
    h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
    const body = await (await decline({ preview: true })).json();
    expect(body.preview).toMatchObject({ payment_cancelled: true });
    expect(h.stripe.calls.expire).toBe(0);
    expect(rsvp().status).toBe("pending_payment");
  });
});
