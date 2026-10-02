import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  pushes: [] as { userIds: string[]; title: string; body: string }[],
  sentry: [] as unknown[],
  promotions: [] as string[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
  getStripePickup: () => h.stripe,
}));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, userIds: string[], msg: { title: string; body: string }) => {
    h.pushes.push({ userIds, title: msg.title, body: msg.body });
  },
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown) => {
    h.sentry.push(e);
  },
}));
vi.mock("@/lib/pickup/waitlist", () => ({
  promoteNextWaitlistPlayer: async (_admin: unknown, runId: string) => {
    h.promotions.push(runId);
    return { ok: true, promoted_user_id: null };
  },
}));

import { POST as cancelPOST } from "@/app/api/sessions/cancel/route";
import { POST as leavePOST } from "@/app/api/sessions/leave/route";
import { REFUND_FIX_CUTOFF, pickupRefundIdempotencyKey } from "@/lib/payments/pickupRefunds";

const HOST = "host-1";
const RUN = "run-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;

function req(userId: string, body: Record<string, unknown>) {
  return new Request("http://test.local/api", {
    method: "POST",
    headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function seedRun(overrides: Record<string, unknown> = {}) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    created_by: HOST,
    fee_cents: FEE,
    status: "planning",
    start_at: iso(72 * HOUR),
    canceled_at: null,
    ...overrides,
  });
  h.db.rows("profiles").push({ id: HOST, is_admin: false, first_name: "Hal", last_name: "Host" });
}

function seedPlayer(userId: string, name: string, rsvp: Record<string, unknown>) {
  h.db.rows("profiles").push({ id: userId, first_name: name, last_name: "Player", username: name.toLowerCase() });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN,
    user_id: userId,
    status: "confirmed",
    paid_at: null,
    checkout_session_id: null,
    payment_intent_id: null,
    refund_id: null,
    ...rsvp,
  });
}

/** Card payer: field fee + $5 photo package captured by Stripe, platform_payments recorded by the webhook. */
function seedCardPayer(userId: string, name: string, pi: string, amountReceived: number, paidAgoMs = 2 * HOUR) {
  const paidAt = iso(-paidAgoMs);
  h.stripe.addPi(pi, amountReceived, { chargeCreatedIso: iso(-paidAgoMs - 60_000) });
  seedPlayer(userId, name, { paid_at: paidAt, payment_intent_id: pi, checkout_session_id: `cs_${pi}` });
  h.db.rows("platform_payments").push({
    id: `pp_${pi}`,
    product_type: "pickup",
    product_entity_id: RUN,
    user_id: userId,
    stripe_checkout_session_id: `cs_${pi}`,
    stripe_payment_intent_id: pi,
    amount_cents: FEE,
    lifecycle_status: "payment_received",
    refunded_at: null,
    metadata: { run_id: RUN, flow: "pickup_rsvp" },
    created_at: paidAt,
  });
}

/** Player who joined entirely with a free-run credit: paid_at set, no PaymentIntent. */
function seedCreditPayer(userId: string, name: string, credit: { amount_cents?: number | null; discount_pct?: number | null }) {
  const paidAt = iso(-3 * HOUR);
  seedPlayer(userId, name, { paid_at: paidAt });
  h.db.rows("pickup_credits").push({
    id: `credit_${userId}`,
    user_id: userId,
    amount_cents: credit.amount_cents ?? null,
    discount_pct: credit.discount_pct ?? null,
    reason: "monthly_pod",
    awarded_at: iso(-30 * 24 * HOUR),
    expires_at: iso(30 * 24 * HOUR),
    used_at: new Date(new Date(paidAt).getTime() - 500).toISOString(),
    run_id: RUN,
    cancelled_run_id: null,
  });
}

function rsvpOf(userId: string) {
  return h.db.rows("pickup_run_rsvps").find((r) => r.user_id === userId)!;
}
function cancellationCredits(userId: string) {
  return h.db.rows("pickup_credits").filter((c) => c.user_id === userId && c.reason === "cancellation");
}
function pushFor(userId: string) {
  return h.pushes.filter((p) => p.userIds.includes(userId));
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.pushes = [];
  h.sentry = [];
  h.promotions = [];
});

describe("host cancel: paid, credit-paid and free players", () => {
  it("refunds the card amount actually charged, credits the credit-paid player, only notifies the free player", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE + 500);
    seedCreditPayer("credit-1", "Cora", { amount_cents: null });
    seedPlayer("free-1", "Fred", {});

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, refunded: 1, credited: 1, cancelled: 3, failures: [] });

    expect(h.stripe.calls.refundsCreate).toBe(1);
    const refund = [...h.stripe.refundsById.values()][0];
    expect(refund.amount).toBe(FEE + 500);
    expect(h.stripe.idem.has(pickupRefundIdempotencyKey(RUN, "paid-1", "pi_paid"))).toBe(true);

    const pp = h.db.rows("platform_payments").find((p) => p.id === "pp_pi_paid")!;
    expect(pp.lifecycle_status).toBe("refunded");
    expect(pp.refunded_at).toBeTruthy();
    expect(pp.metadata).toMatchObject({ refund_id: refund.id, refund_amount_cents: FEE + 500, refund_trigger: "host_cancel" });
    expect(rsvpOf("paid-1")).toMatchObject({ status: "canceled", refund_id: refund.id });

    expect(cancellationCredits("credit-1")).toHaveLength(1);
    expect(cancellationCredits("credit-1")[0]).toMatchObject({ amount_cents: FEE, cancelled_run_id: RUN });
    expect(rsvpOf("credit-1").status).toBe("canceled");

    expect(cancellationCredits("free-1")).toHaveLength(0);
    expect(rsvpOf("free-1").status).toBe("canceled");

    expect(pushFor("paid-1")[0].body).toContain("$10.32 has been refunded");
    expect(pushFor("credit-1")[0].body).toContain("$5.32 credit");
    expect(pushFor("credit-1")[0].body).not.toContain("refunded");
    expect(pushFor("free-1")[0]).toMatchObject({ title: "Session cancelled" });
    expect(pushFor("free-1")[0].body).not.toMatch(/refund|credit/);
    expect(h.db.rows("pickup_runs")[0].status).toBe("canceled");
  });

  it("discount-credit player gets the card portion refunded and the credit portion back as credit", async () => {
    seedRun();
    seedCardPayer("disc-1", "Dana", "pi_disc", 266);
    h.db.rows("pickup_credits").push({
      id: "credit_disc",
      user_id: "disc-1",
      amount_cents: null,
      discount_pct: 50,
      reason: "referral",
      awarded_at: iso(-40 * 24 * HOUR),
      expires_at: iso(40 * 24 * HOUR),
      used_at: rsvpOf("disc-1").paid_at,
      run_id: RUN,
      cancelled_run_id: null,
    });

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(res.status).toBe(200);
    expect([...h.stripe.refundsById.values()][0].amount).toBe(266);
    expect(cancellationCredits("disc-1")[0]).toMatchObject({ amount_cents: 266 });
  });

  it("refunds only what remains when part of the charge was already refunded", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE + 500);
    h.stripe.pis.get("pi_paid")!.amount_refunded = 500;

    await cancelPOST(req(HOST, { run_id: RUN }));
    expect([...h.stripe.refundsById.values()][0].amount).toBe(FEE);
  });

  it("an admin cancelling someone else's run follows the same refund rule as the host", async () => {
    seedRun();
    h.db.rows("profiles").push({ id: "admin-1", is_admin: true });
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);

    const res = await cancelPOST(req("admin-1", { run_id: RUN }));
    expect(res.status).toBe(200);
    expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
  });

  it("expires an open checkout for a pending player without refunding or crediting", async () => {
    seedRun();
    seedPlayer("pend-1", "Pete", { status: "pending_payment", checkout_session_id: "cs_open" });
    h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
    h.db.rows("platform_payments").push({
      id: "pp_open", product_type: "pickup", product_entity_id: RUN, user_id: "pend-1",
      stripe_checkout_session_id: "cs_open", stripe_payment_intent_id: null, lifecycle_status: "checkout_started", metadata: {},
    });

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(res.status).toBe(200);
    expect(h.stripe.calls.expire).toBe(1);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("checkout_expired");
    expect(rsvpOf("pend-1").status).toBe("canceled");
    expect(cancellationCredits("pend-1")).toHaveLength(0);
  });
});

describe("host cancel: failures are surfaced and retries never double-refund", () => {
  it("reports per-player failure with name, keeps that RSVP active, does not tell them they were refunded", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    seedCardPayer("paid-2", "Quinn", "pi_bad", FEE);
    h.stripe.failRefundFor.add("pi_bad");

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.refunded).toBe(1);
    expect(body.failures).toEqual([
      { user_id: "paid-2", name: "Quinn Player", error: "Your card was declined for refund (test)" },
    ]);
    expect(body.error).toMatch(/could not be refunded/);
    expect(rsvpOf("paid-2").status).toBe("confirmed");
    expect(pushFor("paid-2")).toHaveLength(0);
    expect(h.sentry.length).toBeGreaterThan(0);

    h.stripe.failRefundFor.clear();
    const retry = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ ok: true, refunded: 1, cancelled: 1 });
    expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
    expect(h.stripe.pis.get("pi_bad")!.amount_refunded).toBe(FEE);
    expect(pushFor("paid-1")).toHaveLength(1);

    const third = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(third.status).toBe(409);
    expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
  });

  it("treats a Stripe refund in 'failed' state as not refunded", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    h.stripe.nextRefundStatus = "failed";

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.failures[0].error).toMatch(/not issued/);
    expect(rsvpOf("paid-1").status).toBe("confirmed");
    expect(pushFor("paid-1")).toHaveLength(0);
  });

  it("does not refund again when the RSVP update failed after a successful refund", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    h.db.failUpdates.push({ table: "pickup_run_rsvps", message: "db down" });

    const first = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(first.status).toBe(502);
    expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);

    h.db.failUpdates = [];
    const retry = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(retry.status).toBe(200);
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
    expect(pushFor("paid-1")[0].body).toContain("$5.32 has been refunded");
  });

  it("issues at most one cancellation credit per player across retries", async () => {
    seedRun();
    seedCreditPayer("credit-1", "Cora", { amount_cents: 300 });
    seedCardPayer("paid-2", "Quinn", "pi_bad", FEE);
    h.stripe.failRefundFor.add("pi_bad");

    await cancelPOST(req(HOST, { run_id: RUN }));
    rsvpOf("credit-1").status = "confirmed";
    h.stripe.failRefundFor.clear();
    await cancelPOST(req(HOST, { run_id: RUN }));
    expect(cancellationCredits("credit-1")).toHaveLength(1);
    expect(cancellationCredits("credit-1")[0].amount_cents).toBe(300);
  });

  it("refuses to act on runs cancelled before the refund-fix cutoff", async () => {
    const beforeCutoff = new Date(new Date(REFUND_FIX_CUTOFF).getTime() - HOUR).toISOString();
    seedRun({ status: "canceled", canceled_at: beforeCutoff });
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(res.status).toBe(409);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvpOf("paid-1").status).toBe("confirmed");
  });

  it("does not refund a stale payment from an earlier join that was already turned into credit", async () => {
    seedRun();
    const oldCharge = iso(-10 * 24 * HOUR);
    h.stripe.addPi("pi_old", FEE, { chargeCreatedIso: oldCharge });
    seedPlayer("rejoin-1", "Remy", { paid_at: iso(-HOUR), payment_intent_id: "pi_old" });
    h.db.rows("pickup_credits").push({
      id: "old_cancel_credit", user_id: "rejoin-1", amount_cents: FEE, discount_pct: null, reason: "cancellation",
      awarded_at: iso(-9 * 24 * HOUR), expires_at: iso(60 * 24 * HOUR), used_at: iso(-HOUR - 300), run_id: RUN,
      cancelled_run_id: RUN,
    });

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    expect(res.status).toBe(200);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(pushFor("rejoin-1")[0].body).toContain("already added");
  });

  it("flags an unmatched card payment for manual review instead of refunding it", async () => {
    seedRun();
    h.stripe.addPi("pi_old", FEE, { chargeCreatedIso: iso(-10 * 24 * HOUR) });
    seedPlayer("odd-1", "Olly", { paid_at: iso(-HOUR), payment_intent_id: "pi_old" });

    const res = await cancelPOST(req(HOST, { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.failures[0]).toMatchObject({ user_id: "odd-1", name: "Olly Player" });
    expect(body.failures[0].error).toMatch(/manually/);
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });
});

describe("leave: paid, pending and free", () => {
  it("paid player leaving more than 24h out gets a credit for the Stripe net charge (incl. photo package)", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE + 500);
    h.stripe.pis.get("pi_paid")!.amount_refunded = 100;

    const res = await leavePOST(req("paid-1", { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, credit_issued: true, amount_cents: FEE + 400 });
    expect(cancellationCredits("paid-1")[0]).toMatchObject({ amount_cents: FEE + 400, cancelled_run_id: RUN });
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvpOf("paid-1").status).toBe("canceled");
    expect(h.promotions).toEqual([RUN]);
  });

  it("paid player leaving within 24h gets nothing back", async () => {
    seedRun({ start_at: iso(5 * HOUR) });
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);

    const res = await leavePOST(req("paid-1", { run_id: RUN }));
    expect(await res.json()).toMatchObject({ ok: true, credit_issued: false, paid_but_late: true });
    expect(cancellationCredits("paid-1")).toHaveLength(0);
    expect(pushFor("paid-1")[0].body).toContain("within 24 hours");
  });

  it("credit-paid player leaving early gets back what the credit covered", async () => {
    seedRun();
    seedCreditPayer("credit-1", "Cora", { amount_cents: 300 });

    const body = await (await leavePOST(req("credit-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: true, amount_cents: 300 });
  });

  it("pending player can leave: open checkout is expired, no charge, no credit, platform row expired", async () => {
    seedRun();
    seedPlayer("pend-1", "Pete", { status: "pending_payment", checkout_session_id: "cs_open" });
    h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
    h.db.rows("platform_payments").push({
      id: "pp_open", product_type: "pickup", product_entity_id: RUN, user_id: "pend-1",
      stripe_checkout_session_id: "cs_open", stripe_payment_intent_id: null, lifecycle_status: "checkout_started", metadata: {},
    });

    const res = await leavePOST(req("pend-1", { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, credit_issued: false, payment_cancelled: true });
    expect(h.stripe.sessions.get("cs_open")!.status).toBe("expired");
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("checkout_expired");
    expect(rsvpOf("pend-1").status).toBe("canceled");
    expect(cancellationCredits("pend-1")).toHaveLength(0);
    expect(h.promotions).toEqual([RUN]);
  });

  it("pending player whose payment went through meanwhile is treated as paid", async () => {
    seedRun();
    seedPlayer("pend-2", "Paige", { status: "pending_payment", checkout_session_id: "cs_done" });
    h.stripe.addPi("pi_done", FEE);
    h.stripe.sessions.set("cs_done", { id: "cs_done", status: "complete", payment_status: "paid", payment_intent: "pi_done" });

    const body = await (await leavePOST(req("pend-2", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: true, amount_cents: FEE, payment_cancelled: false });
    expect(rsvpOf("pend-2")).toMatchObject({ status: "canceled", payment_intent_id: "pi_done" });
    expect(h.stripe.calls.expire).toBe(0);
  });

  it("pending player with an unfinished PaymentIntent and no session gets it cancelled", async () => {
    seedRun();
    seedPlayer("pend-3", "Pia", { status: "pending_payment", payment_intent_id: "pi_wait" });
    h.stripe.addPi("pi_wait", 0, { status: "requires_payment_method" });

    const body = await (await leavePOST(req("pend-3", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, payment_cancelled: true, credit_issued: false });
    expect(h.stripe.calls.piCancel).toBe(1);
  });

  it("free player leaves with nothing back", async () => {
    seedRun({ fee_cents: 0 });
    seedPlayer("free-1", "Fred", {});

    const body = await (await leavePOST(req("free-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, amount_cents: 0 });
    expect(cancellationCredits("free-1")).toHaveLength(0);
    expect(pushFor("free-1")[0].body).toBe("You have left Tuesday Run.");
  });

  it("a player already credited for this run is not credited twice", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    h.db.rows("pickup_credits").push({
      id: "existing", user_id: "paid-1", amount_cents: FEE, reason: "cancellation", cancelled_run_id: RUN,
      awarded_at: iso(-60_000), expires_at: iso(90 * 24 * HOUR), used_at: null, run_id: null,
    });

    const body = await (await leavePOST(req("paid-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, already_credited: true });
    expect(cancellationCredits("paid-1")).toHaveLength(1);
  });

  it("Stripe outage keeps the player in the session and reports the error", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    h.stripe.pis.delete("pi_paid");

    const res = await leavePOST(req("paid-1", { run_id: RUN }));
    expect(res.status).toBe(502);
    expect(rsvpOf("paid-1").status).toBe("confirmed");
    expect(h.sentry.length).toBe(1);
  });
});

describe("leave: spot paid for by a friend", () => {
  function seedFriendPaid(playerId: string, payerId: string, pi: string, amountReceived: number) {
    seedCardPayer(playerId, "Pat", pi, amountReceived);
    h.db.rows("profiles").push({ id: payerId, first_name: "Fran", last_name: "Friend", username: "fran" });
    const pp = h.db.rows("platform_payments").find((p) => p.id === `pp_${pi}`)!;
    pp.user_id = payerId;
    pp.metadata = { run_id: RUN, flow: "pickup_rsvp", paid_for_user_id: playerId };
  }

  it("credits the payer, not the player, and notifies both", async () => {
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE + 500);

    const res = await leavePOST(req("player-1", { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true, credit_issued: false, amount_cents: 0, payer_credited: true, payer_credit_cents: FEE + 500,
      payer_credit_needs_review: false, payer_name: "Fran Friend",
    });
    expect(cancellationCredits("player-1")).toHaveLength(0);
    expect(cancellationCredits("friend-1")[0]).toMatchObject({
      amount_cents: FEE + 500, cancelled_run_id: RUN, credited_for_user_id: "player-1",
    });
    expect(pushFor("player-1")[0].body).toBe("You left Tuesday Run. Fran Friend paid for your spot, so the $10.32 credit went to them.");
    expect(pushFor("friend-1")[0]).toMatchObject({
      title: "Credit added",
      body: "Pat Player left Tuesday Run. A credit of $10.32 for the spot you paid for has been added to your account.",
    });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("the player's own credit-covered portion still goes back to the player", async () => {
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", 266);
    h.db.rows("pickup_credits").push({
      id: "credit_half", user_id: "player-1", amount_cents: null, discount_pct: 50, reason: "referral",
      awarded_at: iso(-40 * 24 * HOUR), expires_at: iso(40 * 24 * HOUR), used_at: rsvpOf("player-1").paid_at,
      run_id: RUN, cancelled_run_id: null,
    });

    const body = await (await leavePOST(req("player-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ credit_issued: true, amount_cents: 266, payer_credited: true, payer_credit_cents: 266 });
    expect(cancellationCredits("player-1")[0]).toMatchObject({ amount_cents: 266 });
    expect(cancellationCredits("player-1")[0].credited_for_user_id).toBeUndefined();
    expect(cancellationCredits("friend-1")[0]).toMatchObject({ amount_cents: 266, credited_for_user_id: "player-1" });
    expect(pushFor("player-1")[0].body).toContain("A credit of $2.66 has been added to your account.");
  });

  function seedPayerOwnCredit() {
    h.db.rows("pickup_credits").push({
      id: "payer_own", user_id: "friend-1", amount_cents: FEE, reason: "cancellation", cancelled_run_id: RUN,
      awarded_at: iso(-60_000), expires_at: iso(90 * 24 * HOUR), used_at: null, run_id: null,
    });
  }

  function expectNeedsReview(body: Record<string, unknown>) {
    expect(body).toMatchObject({ ok: true, payer_credited: false, payer_credit_cents: FEE, payer_credit_needs_review: true });
    expect((body.warnings as string[])[0]).toMatch(/must be credited manually/);
    expect(h.sentry).toHaveLength(1);
    expect(rsvpOf("player-1").status).toBe("canceled");
    expect(pushFor("friend-1")[0]).toMatchObject({ title: "Credit on its way" });
    expect(pushFor("friend-1")[0].body).toContain("our team will add it");
    expect(pushFor("player-1")[0].body).toContain("the credit for it goes to them");
  }

  it("payer who already holds a credit for their own spot also gets one for the friend's spot", async () => {
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);
    seedPayerOwnCredit();

    const res = await leavePOST(req("player-1", { run_id: RUN }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, payer_credited: true, payer_credit_cents: FEE, payer_credit_needs_review: false });
    expect(body.warnings).toBeUndefined();
    expect(h.sentry).toHaveLength(0);
    const credits = cancellationCredits("friend-1");
    expect(credits).toHaveLength(2);
    expect(credits.find((c) => c.id !== "payer_own")).toMatchObject({ amount_cents: FEE, credited_for_user_id: "player-1" });
    expect(pushFor("friend-1")[0]).toMatchObject({ title: "Credit added" });
  });

  it("payer already credited for this friend's spot is not credited again and nobody is sent to support", async () => {
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);
    h.db.rows("pickup_credits").push({
      id: "for_player", user_id: "friend-1", amount_cents: FEE, reason: "cancellation", cancelled_run_id: RUN,
      credited_for_user_id: "player-1", awarded_at: iso(-30 * 24 * HOUR), expires_at: iso(90 * 24 * HOUR), used_at: null, run_id: null,
    });

    const body = await (await leavePOST(req("player-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, payer_credited: false, payer_already_credited: true, payer_credit_needs_review: false });
    expect(cancellationCredits("friend-1")).toHaveLength(1);
    expect(h.sentry).toHaveLength(0);
    expect(pushFor("friend-1")[0]).toMatchObject({ title: "Credit already added" });
  });

  it("before the migration: payer holding a credit for this run is flagged for review, never told it was added", async () => {
    h.db.beforeCreditedForMigration();
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);
    seedPayerOwnCredit();

    const res = await leavePOST(req("player-1", { run_id: RUN }));
    expect(res.status).toBe(200);
    expectNeedsReview(await res.json());
    expect(cancellationCredits("friend-1")).toHaveLength(1);
  });

  it("before the migration: even a payer with no other credit is flagged rather than given an unlabelled credit", async () => {
    h.db.beforeCreditedForMigration();
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);

    const res = await leavePOST(req("player-1", { run_id: RUN }));
    expect(res.status).toBe(200);
    expectNeedsReview(await res.json());
    expect(cancellationCredits("friend-1")).toHaveLength(0);
  });

  it("old unique index still in place after the column exists: insert conflict is flagged for review", async () => {
    h.db.beforeCreditedForMigration();
    h.db.missingColumns = {};
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);
    seedPayerOwnCredit();

    const res = await leavePOST(req("player-1", { run_id: RUN }));
    expectNeedsReview(await res.json());
    expect(cancellationCredits("friend-1")).toHaveLength(1);
  });

  it("before the migration the player's own credit is unaffected", async () => {
    h.db.beforeCreditedForMigration();
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);

    const body = await (await leavePOST(req("paid-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: true, amount_cents: FEE });
    expect(h.sentry).toHaveLength(0);
  });

  it("a second leave call cannot credit the payer twice", async () => {
    seedRun();
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);

    await leavePOST(req("player-1", { run_id: RUN }));
    const again = await leavePOST(req("player-1", { run_id: RUN }));
    expect(again.status).toBe(404);
    expect(cancellationCredits("friend-1")).toHaveLength(1);
    expect(pushFor("friend-1")).toHaveLength(1);
  });

  it("friend-paid spot left within 24h: no credit for anyone", async () => {
    seedRun({ start_at: iso(5 * HOUR) });
    seedFriendPaid("player-1", "friend-1", "pi_friend", FEE);

    const body = await (await leavePOST(req("player-1", { run_id: RUN }))).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, payer_credited: false, paid_but_late: true });
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(pushFor("friend-1")).toHaveLength(0);
  });
});
