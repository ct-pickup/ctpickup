import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  pushes: [] as { userIds: string[]; title: string; body: string }[],
  sentry: [] as unknown[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
  getStripePickup: () => h.stripe,
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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

import { POST as hostCancelPOST } from "@/app/api/sessions/cancel/route";
import { POST as adminCancelPOST } from "@/app/api/admin/pickup/cancel/route";
import { POST as switchPOST } from "@/app/api/pickup/switch/route";
import { REFUND_FIX_CUTOFF, pickupRefundIdempotencyKey } from "@/lib/payments/pickupRefunds";

const HOST = "host-1";
const ADMIN = "admin-1";
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

type Path = { name: string; trigger: "host_cancel" | "admin_cancel"; cancel: () => Promise<Response> };
const PATHS: Path[] = [
  { name: "host cancel", trigger: "host_cancel", cancel: () => hostCancelPOST(req(HOST, { run_id: RUN })) },
  { name: "admin cancel (sessions/cancel)", trigger: "admin_cancel", cancel: () => hostCancelPOST(req(ADMIN, { run_id: RUN })) },
  { name: "admin cancel (admin/pickup/cancel)", trigger: "admin_cancel", cancel: () => adminCancelPOST(req(ADMIN, { run_id: RUN })) },
  { name: "admin cancel (pickup/switch cancel_run)", trigger: "admin_cancel", cancel: () => switchPOST(req(ADMIN, { action: "cancel_run", run_id: RUN })) },
];

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function seedRun(overrides: Record<string, unknown> = {}) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    created_by: HOST,
    fee_cents: FEE,
    status: "active",
    start_at: iso(72 * HOUR),
    canceled_at: null,
    ...overrides,
  });
  h.db.rows("profiles").push({ id: HOST, is_admin: false, first_name: "Hal", last_name: "Host" });
  h.db.rows("profiles").push({ id: ADMIN, is_admin: true, first_name: "Ada", last_name: "Admin" });
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

function seedCardPayer(userId: string, name: string, pi: string, amountReceived: number, payerId = userId) {
  const paidAt = iso(-2 * HOUR);
  h.stripe.addPi(pi, amountReceived, { chargeCreatedIso: iso(-2 * HOUR - 60_000) });
  seedPlayer(userId, name, { paid_at: paidAt, payment_intent_id: pi, checkout_session_id: `cs_${pi}` });
  h.db.rows("platform_payments").push({
    id: `pp_${pi}`,
    product_type: "pickup",
    product_entity_id: RUN,
    user_id: payerId,
    stripe_checkout_session_id: `cs_${pi}`,
    stripe_payment_intent_id: pi,
    amount_cents: FEE,
    lifecycle_status: "payment_received",
    refunded_at: null,
    metadata: payerId === userId ? { run_id: RUN } : { run_id: RUN, paid_for_user_id: userId },
    created_at: paidAt,
  });
}

function seedCreditPayer(userId: string, name: string) {
  const paidAt = iso(-3 * HOUR);
  seedPlayer(userId, name, { paid_at: paidAt });
  h.db.rows("pickup_credits").push({
    id: `credit_${userId}`, user_id: userId, amount_cents: null, discount_pct: null, reason: "monthly_pod",
    awarded_at: iso(-30 * 24 * HOUR), expires_at: iso(30 * 24 * HOUR),
    used_at: new Date(new Date(paidAt).getTime() - 500).toISOString(), run_id: RUN, cancelled_run_id: null,
  });
}

function rsvpOf(userId: string) {
  return h.db.rows("pickup_run_rsvps").find((r) => r.user_id === userId)!;
}
function cancellationCredits(userId?: string) {
  return h.db.rows("pickup_credits").filter((c) => c.reason === "cancellation" && (!userId || c.user_id === userId));
}
function pushFor(userId: string) {
  return h.pushes.filter((p) => p.userIds.includes(userId));
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.pushes = [];
  h.sentry = [];
});

for (const path of PATHS) {
  describe(path.name, () => {
    it("card: refunds what Stripe actually charged (incl. photo package) to the card, per-RSVP idempotency key", async () => {
      seedRun();
      seedCardPayer("paid-1", "Paula", "pi_paid", FEE + 500);
      const res = await path.cancel();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, refunded: 1, credited: 0, cancelled: 1, failures: [] });
      const refund = [...h.stripe.refundsById.values()][0];
      expect(refund.amount).toBe(FEE + 500);
      expect(h.stripe.idem.has(pickupRefundIdempotencyKey(RUN, "paid-1", "pi_paid"))).toBe(true);
      const pp = h.db.rows("platform_payments")[0];
      expect(pp).toMatchObject({ lifecycle_status: "refunded" });
      expect(pp.metadata).toMatchObject({ refund_amount_cents: FEE + 500, refund_trigger: path.trigger });
      expect(rsvpOf("paid-1")).toMatchObject({ status: "canceled", refund_id: refund.id });
      expect(cancellationCredits()).toHaveLength(0);
      expect(pushFor("paid-1")[0].body).toContain("$10.32 has been refunded to your card");
      expect(h.db.rows("pickup_runs")[0].status).toBe("canceled");
    });

    it("credit: the credit-covered amount comes back as credit to its owner, no Stripe call", async () => {
      seedRun();
      seedCreditPayer("credit-1", "Cora");
      const body = await (await path.cancel()).json();
      expect(body).toMatchObject({ ok: true, refunded: 0, credited: 1 });
      expect(cancellationCredits("credit-1")[0]).toMatchObject({ amount_cents: FEE, cancelled_run_id: RUN });
      expect(h.stripe.calls.refundsCreate).toBe(0);
      expect(pushFor("credit-1")[0].body).toContain("$5.32 credit");
    });

    it("friend-paid: refunded to the friend's card that paid, no credit to anyone", async () => {
      seedRun();
      seedCardPayer("player-1", "Pat", "pi_friend", FEE, "friend-1");
      const body = await (await path.cancel()).json();
      expect(body).toMatchObject({ ok: true, refunded: 1, credited: 0 });
      expect(h.stripe.pis.get("pi_friend")!.amount_refunded).toBe(FEE);
      expect(h.db.rows("platform_payments")[0]).toMatchObject({ user_id: "friend-1", lifecycle_status: "refunded" });
      expect(cancellationCredits()).toHaveLength(0);
    });

    it("free: only notified", async () => {
      seedRun({ fee_cents: 0 });
      seedPlayer("free-1", "Fred", {});
      const body = await (await path.cancel()).json();
      expect(body).toMatchObject({ ok: true, refunded: 0, credited: 0, cancelled: 1 });
      expect(rsvpOf("free-1").status).toBe("canceled");
      expect(pushFor("free-1")[0]).toMatchObject({ title: "Session cancelled" });
      expect(pushFor("free-1")[0].body).not.toMatch(/refund|credit/);
    });

    it("pending: the open checkout is expired, nothing refunded or credited", async () => {
      seedRun();
      seedPlayer("pend-1", "Pete", { status: "pending_payment", checkout_session_id: "cs_open" });
      h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
      h.db.rows("platform_payments").push({
        id: "pp_open", product_type: "pickup", product_entity_id: RUN, user_id: "pend-1",
        stripe_checkout_session_id: "cs_open", stripe_payment_intent_id: null, lifecycle_status: "checkout_started", metadata: {},
      });
      const res = await path.cancel();
      expect(res.status).toBe(200);
      expect(h.stripe.sessions.get("cs_open")!.status).toBe("expired");
      expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("checkout_expired");
      expect(h.stripe.calls.refundsCreate).toBe(0);
      expect(cancellationCredits()).toHaveLength(0);
    });

    it("a failed refund is reported per player and to Sentry; a retry settles it without refunding or crediting twice", async () => {
      seedRun();
      seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
      seedCardPayer("paid-2", "Quinn", "pi_bad", FEE);
      seedCreditPayer("credit-1", "Cora");
      h.stripe.failRefundFor.add("pi_bad");

      const first = await path.cancel();
      const body = await first.json();
      expect(first.status).toBe(502);
      expect(body).toMatchObject({ ok: false, refunded: 1, credited: 1 });
      expect(body.failures).toEqual([{ user_id: "paid-2", name: "Quinn Player", error: "Your card was declined for refund (test)" }]);
      expect(body.error).toMatch(/could not be refunded/);
      expect(rsvpOf("paid-2").status).toBe("confirmed");
      expect(pushFor("paid-2")).toHaveLength(0);
      expect(h.sentry.length).toBeGreaterThan(0);

      h.stripe.failRefundFor.clear();
      const retry = await path.cancel();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ ok: true, refunded: 1, cancelled: 1 });
      expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
      expect(h.stripe.pis.get("pi_bad")!.amount_refunded).toBe(FEE);
      expect(cancellationCredits("credit-1")).toHaveLength(1);

      const third = await path.cancel();
      expect(third.status).toBe(409);
      expect(h.stripe.calls.refundsCreate).toBe(3);
    });

    it("a refund that went through before the RSVP update failed is not issued again on retry", async () => {
      seedRun();
      seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
      h.db.failUpdates.push({ table: "pickup_run_rsvps", message: "db down" });
      expect((await path.cancel()).status).toBe(502);
      h.db.failUpdates = [];
      expect((await path.cancel()).status).toBe(200);
      expect(h.stripe.calls.refundsCreate).toBe(1);
      expect(h.stripe.pis.get("pi_paid")!.amount_refunded).toBe(FEE);
    });

    it("never acts on a run cancelled before REFUND_FIX_CUTOFF and leaves its cancel time alone", async () => {
      const beforeCutoff = new Date(new Date(REFUND_FIX_CUTOFF).getTime() - HOUR).toISOString();
      seedRun({ status: "canceled", canceled_at: beforeCutoff });
      seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
      seedCreditPayer("credit-1", "Cora");
      const res = await path.cancel();
      expect(res.status).toBe(409);
      expect(h.stripe.calls.refundsCreate).toBe(0);
      expect(cancellationCredits()).toHaveLength(0);
      expect(rsvpOf("paid-1").status).toBe("confirmed");
      expect(h.db.rows("pickup_runs")[0].canceled_at).toBe(beforeCutoff);
    });

    it("refuses a completed run", async () => {
      seedRun({ status: "completed" });
      seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
      expect((await path.cancel()).status).toBe(409);
      expect(h.stripe.calls.refundsCreate).toBe(0);
    });
  });
}

describe("admin cancel authorization", () => {
  it("only admins can use admin/pickup/cancel and the switchboard cancel_run", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid", FEE);
    expect((await adminCancelPOST(req(HOST, { run_id: RUN }))).status).toBe(403);
    expect((await switchPOST(req(HOST, { action: "cancel_run", run_id: RUN }))).status).toBe(403);
    expect((await adminCancelPOST(req("paid-1", { run_id: RUN }))).status).toBe(403);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(h.db.rows("pickup_runs")[0].status).toBe("active");
  });

  it("switchboard cancel also takes the run off the hub", async () => {
    seedRun({ is_current: true });
    await switchPOST(req(ADMIN, { action: "cancel_run", run_id: RUN, reason: "Rain" }));
    expect(h.db.rows("pickup_runs")[0]).toMatchObject({ status: "canceled", is_current: false, canceled_reason: "Rain" });
  });
});
