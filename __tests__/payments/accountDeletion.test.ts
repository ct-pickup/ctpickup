import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeSupabase, pinClock } from "./fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fakes").FakeSupabase,
  stripe: null as unknown as import("./fakes").FakeStripe,
  sentry: [] as unknown[],
  promotions: [] as string[],
  pushes: [] as { userIds: string[]; title: string; body: string }[],
  events: [] as string[],
  schemaReady: true,
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
  getStripePickup: () => h.stripe,
  getStripeTournament: () => h.stripe,
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/auth/invalidateUserSessions", () => ({
  invalidateUserSessions: async (_admin: unknown, userId: string) => {
    h.events.push(`sign_out:${userId}`);
    return { ok: true };
  },
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
vi.mock("@/lib/pickup/waitlist", () => ({
  deletePendingWaitlistExpiringReminders: async () => undefined,
  promoteNextWaitlistPlayer: async (_admin: unknown, runId: string) => {
    h.promotions.push(runId);
    return { ok: true, promoted_user_id: null };
  },
}));

import { DELETE as deleteRoute, GET as previewRoute } from "@/app/api/account/delete/route";
import { stripPersonalMetadata } from "@/lib/account/anonymizeUserRecords";
import { POLICY_CHANGE_AT } from "@/lib/payments/pickupRefunds";

const HOUR = 60 * 60 * 1000;
const FEE = 532;
const PLAYER = "player-1";
const FRIEND = "friend-1";
const HOST = "host-1";
const P1 = "p1";
const P2 = "p2";
const PAID_BEFORE = new Date(Date.parse(POLICY_CHANGE_AT) - 24 * HOUR).toISOString();

pinClock("2026-10-20T16:00:00Z");

function iso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function installFakeAdminSurface(db: FakeSupabase) {
  const auth = db.auth as unknown as Record<string, unknown>;
  auth.admin = {
    deleteUser: async (id: string) => {
      h.events.push(`auth_delete:${id}`);
      db.tables.auth_users = db.rows("auth_users").filter((u) => u.id !== id);
      return { error: null };
    },
  };
  Object.assign(db, {
    rpc: async (fn: string) =>
      fn === "account_deletion_anonymize_ready" && h.schemaReady
        ? { data: true, error: null }
        : { data: null, error: { message: `Could not find the function public.${fn}`, code: "PGRST202" } },
  });
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const q = from(table);
    const update = q.update.bind(q);
    q.update = (patch: Record<string, unknown>) => {
      if ((table === "platform_payments" || table === "pickup_run_rsvps") && "user_id" in patch) h.events.push(`anonymize:${table}`);
      return update(patch);
    };
    return q;
  };
  const refundsCreate = h.stripe.refunds.create;
  h.stripe.refunds.create = async (params, options) => {
    const r = await refundsCreate(params, options);
    h.events.push(`refund:${params.payment_intent}`);
    return r;
  };
}

beforeEach(() => {
  h.db = new FakeSupabase();
  h.stripe = new FakeStripe();
  h.sentry = [];
  h.promotions = [];
  h.pushes = [];
  h.events = [];
  h.schemaReady = true;
  installFakeAdminSurface(h.db);
});

function deleteAccount(userId: string, body?: Record<string, unknown>) {
  return deleteRoute(
    new Request("http://test.local/api/account/delete", {
      method: "DELETE",
      headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

function preview(userId: string) {
  return previewRoute(new Request("http://test.local/api/account/delete", { headers: { authorization: `Bearer ${userId}` } }));
}

function addRun(id: string, opts: { startInMs: number; createdBy?: string | null; status?: string }) {
  h.db.rows("pickup_runs").push({
    id,
    title: `Run ${id}`,
    created_by: opts.createdBy ?? "someone-else",
    fee_cents: FEE,
    status: opts.status ?? "active",
    start_at: iso(opts.startInMs),
    cancellation_deadline: null,
    canceled_at: null,
  });
}

/** A paid spot: Stripe charge, RSVP and the payer's platform_payments row. */
function addPaidSpot(opts: { run: string; player: string; payer?: string; pi: string; paidAt?: string; metadata?: Record<string, unknown> }) {
  const paidAt = opts.paidAt ?? iso(-2 * HOUR);
  const paidMs = Date.parse(paidAt);
  h.stripe.addPi(opts.pi, FEE, { chargeCreatedIso: new Date(paidMs - 60_000).toISOString() });
  h.db.rows("pickup_run_rsvps").push({
    id: `rsvp_${opts.run}_${opts.player}`,
    run_id: opts.run,
    user_id: opts.player,
    status: "confirmed",
    paid_at: paidAt,
    payment_intent_id: opts.pi,
    checkout_session_id: `cs_${opts.pi}`,
    refund_id: null,
  });
  h.db.rows("platform_payments").push({
    id: `pp_${opts.pi}`,
    product_type: "pickup",
    product_entity_id: opts.run,
    user_id: opts.payer ?? opts.player,
    stripe_checkout_session_id: `cs_${opts.pi}`,
    stripe_payment_intent_id: opts.pi,
    amount_cents: FEE,
    lifecycle_status: "payment_received",
    refunded_at: null,
    stripe_payment_received_at: paidAt,
    created_at: new Date(paidMs - 5 * 60_000).toISOString(),
    metadata: opts.metadata ?? (opts.payer ? { run_id: opts.run, paid_for_user_id: opts.player } : { run_id: opts.run }),
  });
}

function profile(id: string, first: string) {
  h.db.rows("profiles").push({ id, first_name: first, last_name: "Test" });
  h.db.rows("auth_users").push({ id });
}

function payment(pi: string) {
  return h.db.rows("platform_payments").find((p) => p.stripe_payment_intent_id === pi)!;
}

function rsvpOf(id: string) {
  return h.db.rows("pickup_run_rsvps").find((r) => r.id === id)!;
}

describe("player with past payments, upcoming paid spots and friend-paid spots", () => {
  function seed() {
    profile(PLAYER, "Pat");
    profile(FRIEND, "Fran");
    addRun("past", { startInMs: -72 * HOUR, status: "completed" });
    addPaidSpot({
      run: "past",
      player: PLAYER,
      pi: "pi_past",
      paidAt: iso(-100 * HOUR),
      metadata: { run_id: "past", flow: "pickup_rsvp", customer_email: "pat@example.com", first_name: "Pat", phone: "555-0100" },
    });
    rsvpOf("rsvp_past_player-1").status = "attended";
    addRun("own", { startInMs: 72 * HOUR });
    addPaidSpot({ run: "own", player: PLAYER, pi: "pi_own" });
    addRun("old", { startInMs: 96 * HOUR });
    addPaidSpot({ run: "old", player: PLAYER, pi: "pi_old", paidAt: PAID_BEFORE });
    addRun("friend", { startInMs: 72 * HOUR });
    addPaidSpot({ run: "friend", player: PLAYER, payer: FRIEND, pi: "pi_friend" });
  }

  it("keeps and anonymizes payments, leaves each spot under the policy, and credits the friend payer", async () => {
    seed();
    const paymentCount = h.db.rows("platform_payments").length;

    const res = await deleteAccount(PLAYER, { confirm_upcoming: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(h.db.rows("platform_payments")).toHaveLength(paymentCount);
    expect(h.db.deletes).not.toContain("platform_payments");
    for (const pi of ["pi_past", "pi_own", "pi_old"]) {
      expect(payment(pi)).toMatchObject({ user_id: null, stripe_payment_intent_id: pi, amount_cents: FEE });
      expect(payment(pi).metadata).toMatchObject({ account_deleted_at: expect.any(String) });
    }
    expect(payment("pi_past").metadata).toEqual({ run_id: "past", flow: "pickup_rsvp", account_deleted_at: expect.any(String) });
    expect(payment("pi_friend")).toMatchObject({ user_id: FRIEND, metadata: { run_id: "friend", paid_for_user_id: PLAYER } });

    // Paid after POLICY_CHANGE_AT, own card: the credit would be the deleted user's, so it is forfeited.
    // Paid before it: grandfathered card refund to the card that paid.
    // Friend paid after it: the friend gets the credit for this player's spot.
    const credits = h.db.rows("pickup_credits").filter((c) => c.reason === "cancellation");
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ user_id: FRIEND, cancelled_run_id: "friend", credited_for_user_id: PLAYER, amount_cents: FEE });
    expect(h.stripe.calls.refundsCreate).toBe(1);
    expect(h.stripe.pis.get("pi_old")!.amount_refunded).toBe(FEE);
    expect(h.stripe.pis.get("pi_own")!.amount_refunded).toBe(0);
    expect(h.pushes.find((p) => p.userIds.includes(FRIEND))).toMatchObject({ title: "Credit added" });

    for (const run of ["past", "own", "old", "friend"]) {
      expect(rsvpOf(`rsvp_${run}_player-1`)).toMatchObject({ user_id: null });
    }
    expect(rsvpOf("rsvp_own_player-1").status).toBe("canceled");
    expect(rsvpOf("rsvp_past_player-1").status).toBe("attended");
    expect(h.promotions.sort()).toEqual(["friend", "old", "own"]);

    expect(h.db.rows("profiles").map((p) => p.id)).toEqual([FRIEND]);
    expect(h.events.indexOf("refund:pi_old")).toBeLessThan(h.events.indexOf("anonymize:platform_payments"));
    expect(h.events.indexOf("anonymize:platform_payments")).toBeLessThan(h.events.indexOf(`auth_delete:${PLAYER}`));
    expect(h.events.at(-1)).toBe(`auth_delete:${PLAYER}`);
  });

  it("requires confirmation when there are upcoming games, and changes nothing without it", async () => {
    seed();
    const pre = await preview(PLAYER);
    expect(await pre.json()).toEqual({
      ok: true,
      preview: {
        upcoming_games: 3,
        hosts_upcoming_runs: false,
        hosted_upcoming_runs: 0,
        confirmation_required: true,
        message: "You have 3 upcoming games. Deleting your account gives up those spots and any credits.",
      },
    });

    for (const body of [undefined, { confirm_upcoming: false }, { confirm_upcoming: "yes" }]) {
      const res = await deleteAccount(PLAYER, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ ok: false, code: "confirmation_required", preview: { upcoming_games: 3 } });
    }
    expect(rsvpOf("rsvp_own_player-1")).toMatchObject({ user_id: PLAYER, status: "confirmed" });
    expect(payment("pi_own").user_id).toBe(PLAYER);
    expect(h.stripe.calls.refundsCreate).toBe(0);
    expect(h.events).toEqual([]);
  });

  it("deletes without confirmation when nothing is upcoming", async () => {
    profile(PLAYER, "Pat");
    addRun("past", { startInMs: -72 * HOUR, status: "completed" });
    addPaidSpot({ run: "past", player: PLAYER, pi: "pi_past", paidAt: iso(-100 * HOUR) });
    expect((await (await preview(PLAYER)).json()).preview).toMatchObject({ upcoming_games: 0, confirmation_required: false });
    const res = await deleteAccount(PLAYER);
    expect(res.status).toBe(200);
    expect(payment("pi_past").user_id).toBeNull();
  });
});

describe("host with upcoming runs that have players", () => {
  function seed() {
    profile(HOST, "Hal");
    profile(P1, "Pia");
    profile(P2, "Pete");
    addRun("hosted", { startInMs: 72 * HOUR, createdBy: HOST });
    addPaidSpot({ run: "hosted", player: P1, pi: "pi_p1" });
    addPaidSpot({ run: "hosted", player: P2, pi: "pi_p2" });
    addRun("hosted-past", { startInMs: -72 * HOUR, createdBy: HOST, status: "completed" });
    addRun("elsewhere-past", { startInMs: -48 * HOUR, status: "completed" });
    addPaidSpot({ run: "elsewhere-past", player: HOST, pi: "pi_host_past", paidAt: iso(-50 * HOUR) });
  }

  it("cancels and refunds every player through the host-cancel flow, then deletes the account", async () => {
    seed();
    expect((await (await preview(HOST)).json()).preview).toMatchObject({
      upcoming_games: 0,
      hosts_upcoming_runs: true,
      hosted_upcoming_runs: 1,
      confirmation_required: true,
    });
    expect((await deleteAccount(HOST)).status).toBe(409);

    const res = await deleteAccount(HOST, { confirm_upcoming: true });
    expect(res.status).toBe(200);

    const run = h.db.rows("pickup_runs").find((r) => r.id === "hosted")!;
    expect(run).toMatchObject({ status: "canceled", canceled_reason: "The host deleted their account" });
    expect(h.db.rows("pickup_runs").find((r) => r.id === "hosted-past")!.status).toBe("completed");
    expect(h.stripe.pis.get("pi_p1")!.amount_refunded).toBe(FEE);
    expect(h.stripe.pis.get("pi_p2")!.amount_refunded).toBe(FEE);
    expect(rsvpOf("rsvp_hosted_p1")).toMatchObject({ user_id: P1, status: "canceled" });
    expect(rsvpOf("rsvp_hosted_p2")).toMatchObject({ user_id: P2, status: "canceled" });
    for (const p of [P1, P2]) {
      expect(h.pushes.find((m) => m.userIds.includes(p))).toMatchObject({ title: "Session cancelled, refund issued" });
    }
    expect(payment("pi_host_past")).toMatchObject({ user_id: null, amount_cents: FEE });
    expect(payment("pi_p1").user_id).toBe(P1);

    const authDelete = h.events.indexOf(`auth_delete:${HOST}`);
    expect(h.events.indexOf("refund:pi_p1")).toBeLessThan(authDelete);
    expect(h.events.indexOf("refund:pi_p2")).toBeLessThan(h.events.indexOf("anonymize:platform_payments"));
    expect(h.db.rows("profiles").map((p) => p.id).sort()).toEqual([P1, P2]);
  });

  it("a refund failure stops everything, returns the failing player, and a retry finishes without refunding twice", async () => {
    seed();
    h.stripe.failRefundFor.add("pi_p2");

    const res = await deleteAccount(HOST, { confirm_upcoming: true });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "settlement_failed" });
    expect(body.error).toMatch(/account was not deleted/);
    expect(body.failures).toEqual([
      { run_id: "hosted", user_id: P2, name: "Pete Test", error: expect.stringMatching(/declined/) },
    ]);

    expect(rsvpOf("rsvp_hosted_p2")).toMatchObject({ user_id: P2, status: "confirmed" });
    expect(payment("pi_host_past")).toMatchObject({ user_id: HOST, metadata: { run_id: "elsewhere-past" } });
    expect(rsvpOf("rsvp_elsewhere-past_host-1").user_id).toBe(HOST);
    expect(h.db.rows("profiles").some((p) => p.id === HOST)).toBe(true);
    expect(h.events.filter((e) => !e.startsWith("refund:"))).toEqual([]);
    expect(h.db.deletes).toEqual([]);

    h.stripe.failRefundFor.clear();
    const retry = await deleteAccount(HOST, { confirm_upcoming: true });
    expect(retry.status).toBe(200);
    expect(h.stripe.pis.get("pi_p1")!.amount_refunded).toBe(FEE);
    expect(h.stripe.pis.get("pi_p2")!.amount_refunded).toBe(FEE);
    expect(h.events.filter((e) => e === "refund:pi_p1")).toHaveLength(1);
    expect(payment("pi_host_past").user_id).toBeNull();
    expect(h.events.at(-1)).toBe(`auth_delete:${HOST}`);
  });

  it("a failed player leave also stops the deletion", async () => {
    profile(PLAYER, "Pat");
    addRun("own", { startInMs: 72 * HOUR });
    addPaidSpot({ run: "own", player: PLAYER, pi: "pi_own" });
    h.stripe.pis.delete("pi_own");

    const res = await deleteAccount(PLAYER, { confirm_upcoming: true });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "settlement_failed", failures: [{ run_id: "own", user_id: PLAYER }] });
    expect(rsvpOf("rsvp_own_player-1")).toMatchObject({ user_id: PLAYER, status: "confirmed" });
    expect(payment("pi_own").user_id).toBe(PLAYER);
    expect(h.events).toEqual([]);
  });
});

describe("anonymization cannot happen", () => {
  it("before the migration runs, nothing is touched and a clear error is returned", async () => {
    h.schemaReady = false;
    profile(PLAYER, "Pat");
    addRun("own", { startInMs: 72 * HOUR });
    addPaidSpot({ run: "own", player: PLAYER, pi: "pi_own" });

    const res = await deleteAccount(PLAYER, { confirm_upcoming: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "schema_not_ready", error: expect.stringMatching(/Nothing was changed/) });
    expect(rsvpOf("rsvp_own_player-1").status).toBe("confirmed");
    expect(payment("pi_own").user_id).toBe(PLAYER);
    expect(h.events).toEqual([]);
  });

  it("a NOT NULL violation stops the deletion instead of deleting payments", async () => {
    profile(PLAYER, "Pat");
    addRun("past", { startInMs: -72 * HOUR, status: "completed" });
    addPaidSpot({ run: "past", player: PLAYER, pi: "pi_past", paidAt: iso(-100 * HOUR) });
    h.db.failUpdates.push({ table: "platform_payments", message: 'null value in column "user_id" violates not-null constraint' });

    const res = await deleteAccount(PLAYER);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "anonymize_failed", error: expect.stringMatching(/migration/) });
    expect(h.db.rows("platform_payments")).toHaveLength(1);
    expect(payment("pi_past").user_id).toBe(PLAYER);
    expect(h.db.deletes).toEqual([]);
    expect(h.events.some((e) => e.startsWith("auth_delete"))).toBe(false);
  });
});

describe("stripPersonalMetadata", () => {
  it("strips names, emails, phones and similar, keeping amounts, Stripe ids, run ids, timestamps and paid_for links", () => {
    const out = stripPersonalMetadata(
      {
        run_id: "run-9",
        flow: "pickup_rsvp",
        paid_for_user_id: "friend-2",
        refund_id: "re_1",
        refund_amount_cents: 532,
        refund_trigger: "player_leave",
        stripe_payment_intent_id: "pi_9",
        paid_at: "2026-10-01T00:00:00Z",
        user_id: PLAYER,
        first_name: "Pat",
        lastName: "Player",
        full_name: "Pat Player",
        username: "patp",
        email: "pat@example.com",
        customer_email: "pat@example.com",
        phone: "555-0100",
        phoneNumber: "555-0100",
        billing_address: "1 Main St",
        consent_ip_address: "1.2.3.4",
        user_agent: "Safari",
        note: "reach me at pat@example.com",
        players: [{ id: "x", name: "Pat" }],
      },
      PLAYER,
    );
    expect(out).toEqual({
      run_id: "run-9",
      flow: "pickup_rsvp",
      paid_for_user_id: "friend-2",
      refund_id: "re_1",
      refund_amount_cents: 532,
      refund_trigger: "player_leave",
      stripe_payment_intent_id: "pi_9",
      paid_at: "2026-10-01T00:00:00Z",
      players: [{ id: "x" }],
    });
  });

  it("keeps a paid_for link to the deleted user", () => {
    expect(stripPersonalMetadata({ run_id: "r", paid_for_user_id: PLAYER, payer_name: "Fran" }, PLAYER)).toEqual({
      run_id: "r",
      paid_for_user_id: PLAYER,
    });
  });
});
