import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase } from "./fakes";
import { parseCancelledAt } from "@/lib/pickup/cancelledAt";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  sentry: [] as unknown[],
  promotions: [] as string[],
  recomputes: [] as string[],
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
vi.mock("@/lib/pickup/standing/recomputePickupStanding", () => ({
  recomputePickupStandingForUser: async (_admin: unknown, userId: string) => {
    h.recomputes.push(userId);
  },
}));
vi.mock("@/lib/pickup/waitlist", () => ({
  deletePendingWaitlistExpiringReminders: async () => undefined,
  promoteNextWaitlistPlayer: async (_admin: unknown, runId: string) => {
    h.promotions.push(runId);
    return { ok: true, promoted_user_id: null };
  },
}));

import { POST as lateCancelPOST } from "@/app/api/admin/pickup/late-cancel/route";

const RUN = "run-1";
const ADMIN = "admin-1";
const PLAYER = "player-1";
const FRIEND = "friend-1";
const FEE = 532;
const HOUR = 60 * 60 * 1000;

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function lateCancel(extra: Record<string, unknown> = {}, token = ADMIN) {
  return lateCancelPOST(
    new Request("http://test.local/api/admin/pickup/late-cancel", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN, user_id: PLAYER, ...extra }),
    }),
  );
}

function seedPaid(opts: { startInMs?: number; amountReceived?: number; payer?: string } = {}) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    fee_cents: FEE,
    status: "active",
    start_at: iso(opts.startInMs ?? 72 * HOUR),
    cancellation_deadline: null,
  });
  const paidAt = iso(-2 * HOUR);
  h.stripe.addPi("pi_1", opts.amountReceived ?? FEE, { chargeCreatedIso: iso(-2 * HOUR - 60_000) });
  h.db.rows("pickup_run_rsvps").push({
    run_id: RUN,
    user_id: PLAYER,
    status: "confirmed",
    paid_at: paidAt,
    payment_intent_id: "pi_1",
    checkout_session_id: "cs_1",
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
function lateIncidents() {
  return h.db.rows("pickup_reliability_incidents").filter((r) => r.user_id === PLAYER && r.kind === "late_cancel");
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.db.uniques.push({ table: "pickup_reliability_incidents", key: (r) => [r.user_id, r.run_id, r.kind] });
  h.db.rows("profiles").push({ id: ADMIN, is_admin: true });
  h.db.rows("profiles").push({ id: PLAYER, first_name: "Pat", last_name: "Player" });
  h.stripe = new FakeStripe();
  h.sentry = [];
  h.promotions = [];
  h.recomputes = [];
  h.pushes = [];
});

describe("admin late cancel follows the player-initiated policy", () => {
  it("more than 24h before kickoff: credit for what was paid, no late cancel on standing", async () => {
    seedPaid();
    const res = await lateCancel();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "canceled", within_24h: false, standing_recorded: false, credit_issued: true, amount_cents: FEE });
    expect(body.message).toBe("Cancelled Pat Player's spot (more than 24 hours before kickoff). Pat Player got a $5.32 credit.");
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(cancellationCredits(PLAYER)[0]).toMatchObject({ amount_cents: FEE, cancelled_run_id: RUN });
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvp().status).toBe("canceled");
    expect(lateIncidents()).toHaveLength(0);
    expect(h.promotions).toEqual([RUN]);
  });

  it("inside 24h: nothing back, late cancel recorded, waitlist promoted", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    const body = await (await lateCancel({ note: "texted the host" })).json();
    expect(body).toMatchObject({ ok: true, status: "late_canceled", within_24h: true, standing_recorded: true, credit_issued: false, paid_but_late: true });
    expect(body.message).toBe(
      "Cancelled Pat Player's spot (within 24 hours of kickoff). No refund or credit applies within 24 hours of kickoff. A late cancel was recorded against their standing.",
    );
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(rsvp().status).toBe("late_canceled");
    expect(lateIncidents()).toHaveLength(1);
    expect(lateIncidents()[0]).toMatchObject({ source: "admin", note: "texted the host" });
    expect(h.recomputes).toEqual([PLAYER]);
    expect(h.promotions).toEqual([RUN]);
  });

  it("cancelled_at decides the window: told 3 days ago, game in 5 hours, still a credit", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    const body = await (await lateCancel({ cancelled_at: iso(-72 * HOUR) })).json();
    expect(body).toMatchObject({ ok: true, status: "canceled", within_24h: false, credit_issued: true, amount_cents: FEE });
    expect(lateIncidents()).toHaveLength(0);
  });

  it("cancelled_at exactly 24h before kickoff is already inside the window", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    const startMs = new Date(h.db.rows("pickup_runs")[0].start_at as string).getTime();
    const body = await (await lateCancel({ cancelled_at: new Date(startMs - 24 * HOUR).toISOString() })).json();
    expect(body).toMatchObject({ within_24h: true, credit_issued: false });
  });

  it("friend-paid: the credit goes to the payer for this player's spot", async () => {
    seedPaid({ payer: FRIEND });
    const body = await (await lateCancel()).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, payer_credited: true, payer_credit_cents: FEE, payer_name: "Fran Friend" });
    expect(body.message).toBe("Cancelled Pat Player's spot (more than 24 hours before kickoff). Fran Friend paid for the spot and got a $5.32 credit.");
    expect(cancellationCredits(PLAYER)).toHaveLength(0);
    expect(cancellationCredits(FRIEND)[0]).toMatchObject({ amount_cents: FEE, credited_for_user_id: PLAYER });
    expect(h.stripe.calls.refundsCreate).toBe(0);
  });

  it("friend-paid before the credited_for migration: flagged for review, not silently dropped", async () => {
    h.db.beforeCreditedForMigration();
    seedPaid({ payer: FRIEND });
    const body = await (await lateCancel()).json();
    expect(body).toMatchObject({ ok: true, payer_credited: false, payer_credit_needs_review: true });
    expect(body.warnings[0]).toMatch(/must be credited manually/);
    expect(body.message).toMatch(/needs to be added manually/);
  });

  it("a retry does not credit twice", async () => {
    seedPaid();
    await lateCancel();
    const again = await lateCancel();
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "canceled" });
    expect(body.message).toBe("Pat Player was already cancelled; no money was moved.");
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
    expect(h.promotions).toEqual([RUN]);
  });

  it("an existing credit for this run is not duplicated", async () => {
    seedPaid();
    h.db.rows("pickup_credits").push({
      id: "existing", user_id: PLAYER, amount_cents: FEE, reason: "cancellation", cancelled_run_id: RUN,
      awarded_at: iso(-60_000), expires_at: iso(90 * 24 * HOUR), used_at: null, run_id: null,
    });
    const body = await (await lateCancel()).json();
    expect(body).toMatchObject({ ok: true, credit_issued: false, already_credited: true });
    expect(body.message).toBe("Cancelled Pat Player's spot (more than 24 hours before kickoff). Pat Player was already credited for this run earlier.");
    expect(cancellationCredits(PLAYER)).toHaveLength(1);
  });

  it("a repeated late cancel inside 24h records standing once", async () => {
    seedPaid({ startInMs: 5 * HOUR });
    await lateCancel();
    await lateCancel();
    expect(lateIncidents()).toHaveLength(1);
  });

  it("a pending checkout is expired with no credit", async () => {
    h.db.rows("pickup_runs").push({ id: RUN, title: "Tuesday Run", fee_cents: FEE, status: "active", start_at: iso(72 * HOUR) });
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "pending_payment", checkout_session_id: "cs_open" });
    h.stripe.sessions.set("cs_open", { id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null });
    const body = await (await lateCancel()).json();
    expect(body).toMatchObject({ ok: true, payment_cancelled: true, credit_issued: false });
    expect(h.stripe.sessions.get("cs_open")!.status).toBe("expired");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
  });

  it("a Stripe outage leaves the player in and records nothing", async () => {
    seedPaid();
    h.stripe.pis.delete("pi_1");
    const res = await lateCancel();
    expect(res.status).toBe(502);
    expect(rsvp().status).toBe("confirmed");
    expect(h.db.rows("pickup_credits")).toHaveLength(0);
    expect(lateIncidents()).toHaveLength(0);
    expect(h.promotions).toEqual([]);
  });

  it("non-admins are refused", async () => {
    seedPaid();
    const res = await lateCancel({}, PLAYER);
    expect(res.status).toBe(403);
    expect(rsvp().status).toBe("confirmed");
  });
});

describe("cancelled_at validation", () => {
  it.each([
    ["not a date", "yesterday"],
    ["date only", "2026-10-01"],
    ["no timezone", "2026-10-01T10:00:00"],
    ["impossible date", "2026-13-45T10:00:00Z"],
    ["a number", 1700000000000],
  ])("rejects %s", async (_label, value) => {
    seedPaid();
    const res = await lateCancel({ cancelled_at: value });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ISO date-time/);
    expect(rsvp().status).toBe("confirmed");
  });

  it("rejects a time in the future", async () => {
    seedPaid();
    const res = await lateCancel({ cancelled_at: iso(2 * HOUR) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cancelled_at cannot be in the future.");
  });

  it("rejects a time after kickoff", async () => {
    seedPaid({ startInMs: -3 * HOUR });
    const res = await lateCancel({ cancelled_at: iso(-HOUR) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cancelled_at cannot be after kickoff.");
    expect(rsvp().status).toBe("confirmed");
  });

  it("parser: defaults to now, accepts offsets, skips the kickoff check for date-only runs", () => {
    const now = Date.parse("2026-10-02T18:00:00Z");
    expect(parseCancelledAt(undefined, { start_at: null }, now)).toEqual({ ok: true, ms: now });
    expect(parseCancelledAt("2026-10-02T10:00:00-04:00", { start_at: null }, now)).toEqual({ ok: true, ms: Date.parse("2026-10-02T14:00:00Z") });
    expect(parseCancelledAt("2026-10-02T17:00:00Z", { start_at: "2026-10-02T00:00:00+00:00" }, now)).toMatchObject({ ok: true });
    expect(parseCancelledAt("2026-10-02T17:00:00Z", { start_at: "2026-10-02T16:00:00Z" }, now)).toMatchObject({ ok: false });
  });
});
