import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  pushes: [] as { userIds: string[]; title: string; body: string }[],
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
vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));

import { GET as deleteRunGET, POST as deleteRunPOST } from "@/app/api/admin/pickup/delete-run/route";
import { POST as adminCancelPOST } from "@/app/api/admin/pickup/cancel/route";
import { pickupRefundIdempotencyKey } from "@/lib/payments/pickupRefunds";

const ADMIN = "admin-1";
const RUN = "run-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function post(userId: string, body: Record<string, unknown>) {
  return new Request("http://test.local/api", {
    method: "POST",
    headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRun(userId = ADMIN) {
  return deleteRunPOST(post(userId, { run_id: RUN }));
}

function seedRun(overrides: Record<string, unknown> = {}) {
  h.db.rows("pickup_runs").push({
    id: RUN, title: "Tuesday Run", fee_cents: FEE, status: "active", start_at: iso(72 * HOUR), canceled_at: null, ...overrides,
  });
  h.db.rows("profiles").push({ id: ADMIN, is_admin: true, first_name: "Ada", last_name: "Admin" });
}

function seedPlayer(userId: string, name: string, rsvp: Record<string, unknown> = {}) {
  h.db.rows("profiles").push({ id: userId, first_name: name, last_name: "Player", username: name.toLowerCase() });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN, user_id: userId, status: "confirmed", paid_at: null, checkout_session_id: null, payment_intent_id: null, refund_id: null, ...rsvp,
  });
}

function seedPayment(pi: string, userId: string, extra: Record<string, unknown> = {}) {
  h.db.rows("platform_payments").push({
    id: `pp_${pi}`, product_type: "pickup", product_entity_id: RUN, user_id: userId,
    stripe_checkout_session_id: `cs_${pi}`, stripe_payment_intent_id: pi, amount_cents: FEE,
    lifecycle_status: "payment_received", refunded_at: null, metadata: { run_id: RUN }, created_at: iso(-2 * HOUR), ...extra,
  });
}

function seedCardPayer(userId: string, name: string, pi: string, payerId = userId) {
  h.stripe.addPi(pi, FEE, { chargeCreatedIso: iso(-2 * HOUR - 60_000) });
  seedPlayer(userId, name, { paid_at: iso(-2 * HOUR), payment_intent_id: pi, checkout_session_id: `cs_${pi}` });
  seedPayment(pi, payerId, payerId === userId ? {} : { metadata: { run_id: RUN, paid_for_user_id: userId } });
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

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.pushes = [];
});

describe("admin delete run", () => {
  it("deletes a run with no players or payments", async () => {
    seedRun();
    h.db.rows("pickup_run_invites").push({ run_id: RUN, user_id: "invitee-1" });
    h.db.rows("pickup_run_time_slots").push({ id: "slot-1", run_id: RUN });

    const res = await deleteRun();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.db.rows("pickup_runs")).toHaveLength(0);
    expect(h.db.rows("pickup_run_invites")).toHaveLength(0);
    expect(h.db.rows("pickup_run_time_slots")).toHaveLength(0);
    expect(h.db.deletes).not.toContain("pickup_run_rsvps");
    expect(h.db.deletes).not.toContain("platform_payments");
  });

  it("refuses with 409 when the run has paid players and deletes nothing", async () => {
    seedRun();
    seedCardPayer("paid-1", "Paula", "pi_paid");

    const res = await deleteRun();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "run_has_players", rsvps: 1, payments: 1 });
    expect(body.error).toMatch(/Cancel it instead/);
    expect(h.db.deletes).toEqual([]);
    expect(h.db.rows("pickup_runs")).toHaveLength(1);
    expect(h.db.rows("pickup_run_rsvps")).toHaveLength(1);
    expect(h.db.rows("platform_payments")).toHaveLength(1);
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("refuses with 409 when the run only has unpaid RSVPs in any status", async () => {
    seedRun();
    seedPlayer("wait-1", "Wendy", { status: "waitlist" });
    seedPlayer("gone-1", "Gus", { status: "canceled" });

    const res = await deleteRun();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ rsvps: 2, payments: 0 });
    expect(h.db.deletes).toEqual([]);
    expect(h.db.rows("pickup_run_rsvps")).toHaveLength(2);
  });

  it("refuses with 409 when a payment exists without an RSVP", async () => {
    seedRun();
    seedPayment("pi_orphan", "payer-1", { product_entity_id: "other", lifecycle_status: "checkout_expired" });

    const res = await deleteRun();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ rsvps: 0, payments: 1 });
    expect(h.db.rows("pickup_runs")).toHaveLength(1);
  });

  it("is admin only", async () => {
    seedRun();
    h.db.rows("profiles").push({ id: "player-1", is_admin: false });
    expect((await deleteRun("player-1")).status).toBe(403);
    expect(h.db.rows("pickup_runs")).toHaveLength(1);
  });

  it("GET reports whether the run can be deleted", async () => {
    seedRun();
    const get = () => deleteRunGET(new Request(`http://test.local/api?run_id=${RUN}`, { headers: { authorization: `Bearer ${ADMIN}` } }));
    expect(await (await get()).json()).toEqual({ rsvps: 0, payments: 0, deletable: true });
    seedPlayer("free-1", "Fred");
    expect(await (await get()).json()).toEqual({ rsvps: 1, payments: 0, deletable: false });
  });
});

describe("cancel run instead of delete", () => {
  it("settles card, credit, free and friend-paid players; a retry after a partial failure does not refund twice", async () => {
    seedRun();
    seedCardPayer("card-1", "Cara", "pi_card");
    seedCreditPayer("credit-1", "Cora");
    seedPlayer("free-1", "Fred");
    seedCardPayer("player-1", "Pat", "pi_friend", "friend-1");
    h.stripe.failRefundFor.add("pi_friend");

    const first = await adminCancelPOST(post(ADMIN, { run_id: RUN }));
    expect(first.status).toBe(502);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ ok: false, refunded: 1, credited: 1, cancelled: 3 });
    expect(firstBody.failures).toEqual([{ user_id: "player-1", name: "Pat Player", error: "Your card was declined for refund (test)" }]);
    expect(rsvpOf("player-1").status).toBe("confirmed");
    expect(h.pushes.filter((p) => p.userIds.includes("player-1"))).toHaveLength(0);
    expect(h.pushes.find((p) => p.userIds.includes("free-1"))!.body).not.toMatch(/refund|credit/);
    expect(h.db.rows("pickup_runs")[0].status).toBe("canceled");

    h.stripe.failRefundFor.clear();
    const retry = await adminCancelPOST(post(ADMIN, { run_id: RUN }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ ok: true, refunded: 1, credited: 0, cancelled: 1 });

    expect(h.stripe.pis.get("pi_card")!.amount_refunded).toBe(FEE);
    expect(h.stripe.pis.get("pi_friend")!.amount_refunded).toBe(FEE);
    expect(h.stripe.idem.has(pickupRefundIdempotencyKey(RUN, "player-1", "pi_friend"))).toBe(true);
    expect(h.stripe.calls.refundsCreate).toBe(3);
    expect(h.db.rows("platform_payments").find((p) => p.id === "pp_pi_friend")).toMatchObject({ user_id: "friend-1", lifecycle_status: "refunded" });
    expect(h.db.rows("pickup_credits").filter((c) => c.reason === "cancellation")).toHaveLength(1);
    expect(h.db.rows("pickup_run_rsvps").every((r) => r.status === "canceled")).toBe(true);

    expect(h.db.deletes).toEqual([]);
    expect(h.db.rows("pickup_runs")).toHaveLength(1);
    expect(h.db.rows("pickup_run_rsvps")).toHaveLength(4);
    expect(h.db.rows("platform_payments")).toHaveLength(2);
  });

  it("only reports a refund once Stripe confirms it", async () => {
    seedRun();
    seedCardPayer("card-1", "Cara", "pi_card");
    h.stripe.nextRefundStatus = "failed";

    const res = await adminCancelPOST(post(ADMIN, { run_id: RUN }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, refunded: 0 });
    expect(body.failures[0]).toMatchObject({ user_id: "card-1" });
    expect(body.failures[0].error).toMatch(/not issued/);
    expect(rsvpOf("card-1").status).toBe("confirmed");
    expect(h.db.rows("platform_payments")[0].lifecycle_status).toBe("payment_received");
    expect(h.pushes).toHaveLength(0);
  });
});
