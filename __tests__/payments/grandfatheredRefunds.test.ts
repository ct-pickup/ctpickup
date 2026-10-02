import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase, pinClock } from "./fakes";

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
vi.mock("@/lib/pickup/standing/recomputePickupStanding", () => ({ recomputePickupStandingForUser: async () => undefined }));
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
import { POST as lateCancelPOST } from "@/app/api/admin/pickup/late-cancel/route";
import { POLICY_CHANGE_AT } from "@/lib/payments/pickupRefunds";

const RUN = "run-1";
const PLAYER = "player-1";
const FRIEND = "friend-1";
const ADMIN = "admin-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;
const PAID_BEFORE = new Date(Date.parse(POLICY_CHANGE_AT) - 24 * HOUR).toISOString();
const PAID_AFTER = new Date(Date.parse(POLICY_CHANGE_AT) + 24 * HOUR).toISOString();

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function post(handler: (req: Request) => Promise<Response>, path: string, token: string, body: Record<string, unknown>) {
  return handler(
    new Request(`http://test.local${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
const decline = (extra: Record<string, unknown> = {}) => post(rsvpPOST, "/api/pickup/rsvp", PLAYER, { action: "decline", run_id: RUN, ...extra });
const leave = (extra: Record<string, unknown> = {}) => post(leavePOST, "/api/sessions/leave", PLAYER, { run_id: RUN, ...extra });
const lateCancel = () => post(lateCancelPOST, "/api/admin/pickup/late-cancel", ADMIN, { run_id: RUN, user_id: PLAYER });

function seedPaid(opts: {
  paidAt: string;
  startInMs?: number;
  amountReceived?: number;
  payer?: string;
  creditCovered?: number;
  checkoutStartedAt?: string;
}) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    run_type: "public",
    created_by: null,
    final_slot_id: null,
    fee_cents: FEE,
    status: "active",
    start_at: iso(opts.startInMs ?? 72 * HOUR),
    cancellation_deadline: null,
  });
  h.db.rows("profiles").push({ id: PLAYER, approved: true, tier_rank: 1, tier: null, is_banned: false, first_name: "Pat", last_name: "Player" });
  h.db.rows("profiles").push({ id: ADMIN, is_admin: true });
  if (opts.payer) h.db.rows("profiles").push({ id: opts.payer, first_name: "Fran", last_name: "Friend" });
  const paidMs = Date.parse(opts.paidAt);
  h.stripe.addPi("pi_1", opts.amountReceived ?? FEE, { chargeCreatedIso: new Date(paidMs - 60_000).toISOString() });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN,
    user_id: PLAYER,
    status: "confirmed",
    paid_at: opts.paidAt,
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
    stripe_payment_received_at: opts.paidAt,
    created_at: opts.checkoutStartedAt ?? new Date(paidMs - 5 * 60_000).toISOString(),
  });
  if (opts.creditCovered) {
    h.db.rows("pickup_credits").push({
      id: "pod", user_id: PLAYER, amount_cents: opts.creditCovered, discount_pct: null, reason: "monthly_pod",
      awarded_at: new Date(paidMs - 30 * 24 * HOUR).toISOString(), expires_at: iso(30 * 24 * HOUR),
      used_at: opts.paidAt, run_id: RUN, cancelled_run_id: null,
    });
  }
}

function rsvp() {
  return h.db.rows("pickup_run_rsvps").find((r) => r.user_id === PLAYER)!;
}
function cancellationCredits(userId: string) {
  return h.db.rows("pickup_credits").filter((c) => c.user_id === userId && c.reason === "cancellation");
}

pinClock("2026-10-20T16:00:00Z");

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.sentry = [];
  h.promotions = [];
  h.pushes = [];
});

describe("paid before POLICY_CHANGE_AT (old terms)", () => {
  it("leave more than 24h out: refunds the card for what Stripe charged, no credit", async () => {
    seedPaid({ paidAt: PAID_BEFORE, amountReceived: FEE + 500 });
    const res = await leave();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, refunded_to_card: true, refund_cents: FEE + 500, credit_issued: false });
    expect(body.message).toBe("You left Tuesday Run. $10.32 was refunded to your card. It can take 5 to 10 business days to appear.");
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.stripe.idem.has(`refund:pickup:${RUN}:${PLAYER}:pi_1`)).toBe(true);
    expect(h.stripe.pis.get("pi_1")!.amount_refunded).toBe(FEE + 500);
    expect(h.db.rows("platform_payments")[0]).toMatchObject({ lifecycle_status: "refunded" });
    expect(rsvp()).toMatchObject({ status: "canceled", refund_id: "re_1" });
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("decline inside 24h: nothing, same as the old terms promised", async () => {
    seedPaid({ paidAt: PAID_BEFORE, startInMs: 5 * HOUR });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, refunded_to_card: false, credit_issued: false, paid_but_late: true });
    expect(body.message).toBe("You left Tuesday Run. No refund or credit applies within 24 hours of kickoff.");
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("friend paid: the friend's card is refunded and the friend is told; nobody gets credit", async () => {
    seedPaid({ paidAt: PAID_BEFORE, payer: FRIEND });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, refunded_to_card: true, refund_cents: FEE, refunded_to_payer: true, payer_name: "Fran Friend" });
    expect(body.message).toBe("You left Tuesday Run. Fran Friend paid for your spot, so $5.32 was refunded to their card.");
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.db.rows("pickup_credits").filter((c) => c.reason === "cancellation")).toHaveLength(0);
    expect(h.pushes.find((p) => p.userIds.includes(FRIEND))).toMatchObject({ title: "Refund issued" });
  });

  it("card plus credit: card refunded, the credit-covered part comes back as credit", async () => {
    seedPaid({ paidAt: PAID_BEFORE, amountReceived: FEE - 300 + 500, creditCovered: 300 });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ ok: true, refund_cents: 732, credit_issued: true, amount_cents: 300 });
    expect(body.message).toBe(
      "You left Tuesday Run. $7.32 was refunded to your card. It can take 5 to 10 business days to appear. A credit of $3.00 has been added to your account.",
    );
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(cancellationCredits(PLAYER)[0]).toMatchObject({ amount_cents: 300 });
  });

  it("a card refund failure keeps the spot active, and a retry refunds once", async () => {
    seedPaid({ paidAt: PAID_BEFORE });
    h.stripe.failRefundFor.add("pi_1");
    const res = await leave();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/You are still in the session/);
    expect(rsvp().status).toBe("confirmed");
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("payment_received");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(h.sentry).toHaveLength(1);
    expect(h.promotions).toEqual([]);

    h.stripe.failRefundFor.clear();
    const again = await leave();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ refunded_to_card: true, refund_cents: FEE });
    expect(h.stripe.pis.get("pi_1")!.amount_refunded).toBe(FEE);
    expect(rsvp().status).toBe("canceled");
  });

  it("retry after the spot update failed: no second refund, reports it was already refunded", async () => {
    seedPaid({ paidAt: PAID_BEFORE, creditCovered: 300, amountReceived: FEE - 300 });
    h.db.failUpdates.push({ table: "pickup_run_rsvps", message: "db down" });
    const first = await leave();
    expect(first.status).toBe(500);
    expect(rsvp().status).toBe("confirmed");
    expect(h.stripe.calls.refundsCreate).toBe(1);

    h.db.failUpdates = [];
    const again = await leave();
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body).toMatchObject({ refunded_to_card: false, already_refunded: true, refund_cents: FEE - 300, amount_cents: 300 });
    expect(body.message).toBe("You left Tuesday Run. The $2.32 card payment for your spot was already refunded. A credit of $3.00 has been added to your account.");
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.stripe.pis.get("pi_1")!.amount_refunded).toBe(FEE - 300);
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(rsvp().status).toBe("canceled");
  });

  it("admin late cancel more than 24h out refunds the card and says so", async () => {
    seedPaid({ paidAt: PAID_BEFORE });
    const body = await (await lateCancel()).json();
    expect(body).toMatchObject({ ok: true, status: "canceled", within_24h: false, refunded_to_card: true, refund_cents: FEE });
    expect(body.message).toBe("Cancelled Pat Player's spot (more than 24 hours before kickoff). Paid before the policy change, so $5.32 was refunded to Pat Player's card.");
    expect(h.stripe.calls.refundsCreate).toBe(1);
  });
});

describe("paid on or after POLICY_CHANGE_AT (new terms)", () => {
  it("more than 24h out: credit, never a card refund", async () => {
    seedPaid({ paidAt: PAID_AFTER, amountReceived: FEE + 500 });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ ok: true, refunded_to_card: false, refund_cents: 0, credit_issued: true, amount_cents: FEE + 500 });
    expect(body.message).toBe("You left Tuesday Run. A credit of $10.32 has been added to your account.");
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("paid exactly at POLICY_CHANGE_AT is the new terms", async () => {
    seedPaid({ paidAt: POLICY_CHANGE_AT });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ credit_issued: true, amount_cents: FEE, refunded_to_card: false });
  });

  it("inside 24h: nothing", async () => {
    seedPaid({ paidAt: PAID_AFTER, startInMs: 5 * HOUR });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, refunded_to_card: false, paid_but_late: true });
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("friend paid: the friend gets the credit", async () => {
    seedPaid({ paidAt: PAID_AFTER, payer: FRIEND });
    const body = await (await decline()).json();
    expect(body).toMatchObject({ ok: true, payer_credited: true, payer_credit_cents: FEE, refunded_to_card: false });
    expect(cancellationCredits(FRIEND)[0]).toMatchObject({ amount_cents: FEE, credited_for_user_id: PLAYER });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("card plus credit: one credit for both parts", async () => {
    seedPaid({ paidAt: PAID_AFTER, amountReceived: FEE - 300 + 500, creditCovered: 300 });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ credit_issued: true, amount_cents: FEE + 500, refunded_to_card: false });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("paid-at is when the payment was received, not when checkout started", async () => {
    seedPaid({ paidAt: PAID_AFTER, checkoutStartedAt: PAID_BEFORE });
    const body = await (await leave()).json();
    expect(body).toMatchObject({ credit_issued: true, refunded_to_card: false });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });
});

describe("preview messages", () => {
  it("old terms: decline and leave previews promise a card refund and change nothing", async () => {
    seedPaid({ paidAt: PAID_BEFORE, amountReceived: FEE + 500 });
    for (const call of [decline, leave]) {
      const body = await (await call({ preview: true })).json();
      expect(body.preview).toMatchObject({ refund_cents: FEE + 500, credit_cents: 0, message: "You'll be refunded $10.32 to your card." });
    }
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvp().status).toBe("confirmed");
  });

  it("old terms, friend paid: names the friend's card", async () => {
    seedPaid({ paidAt: PAID_BEFORE, payer: FRIEND });
    const body = await (await leave({ preview: true })).json();
    expect(body.preview).toMatchObject({ refund_cents: FEE, payer_name: "Fran Friend" });
    expect(body.preview.message).toBe("Fran Friend paid for your spot, so they'll be refunded $5.32 to their card.");
  });

  it("old terms, card plus credit: both parts", async () => {
    seedPaid({ paidAt: PAID_BEFORE, amountReceived: FEE - 300, creditCovered: 300 });
    const body = await (await decline({ preview: true })).json();
    expect(body.preview.message).toBe("You'll be refunded $2.32 to your card. You'll get a $3.00 credit.");
  });

  it("new terms: previews promise a credit", async () => {
    seedPaid({ paidAt: PAID_AFTER, amountReceived: FEE + 500 });
    for (const call of [decline, leave]) {
      const body = await (await call({ preview: true })).json();
      expect(body.preview).toMatchObject({ refund_cents: 0, credit_cents: FEE + 500, message: "You'll get a $10.32 credit." });
    }
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("inside 24h: no refund or credit under either terms", async () => {
    seedPaid({ paidAt: PAID_BEFORE, startInMs: 5 * HOUR });
    const body = await (await leave({ preview: true })).json();
    expect(body.preview).toMatchObject({ refund_cents: 0, paid_but_late: true, message: "No refund or credit applies within 24 hours of kickoff." });
  });
});
