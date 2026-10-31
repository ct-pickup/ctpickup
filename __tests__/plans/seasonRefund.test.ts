import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeClient, makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, refund: vi.fn(), pushed: [] as unknown[][], applyStatus: "declined", prevStatus: "new" }));

vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdminBearer: async () => ({ ok: true, userId: "admin-1" }) }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => fakeClient(h.db) }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async (...a: unknown[]) => void h.pushed.push(a) }));
vi.mock("@/lib/fields/venueReply", () => ({
  parseReplyInput: () => ({ ok: true, input: {} }),
  applyReply: async () => ({
    ok: true,
    request: { user_id: "u1", venue_key: "v1", requested_date: "2026-11-07", start_time: "11:00:00", duration_hours: 2 },
    previousStatus: h.prevStatus,
    newStatus: h.applyStatus,
    replyId: "r1",
    mode: "x",
    fields: {},
  }),
}));
vi.mock("stripe", () => ({ default: class { refunds = { create: h.refund }; } }));

import { PATCH } from "../../app/api/admin/field-requests/route";
import { POST as reply } from "../../app/api/admin/field-requests/reply/route";
import { refundSeasonForRequest } from "../../lib/plans/seasonRefund";

const patch = (body: unknown) => new Request("https://site.test/api/admin/field-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const replyReq = () => new Request("https://site.test/api/admin/field-requests/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: "req1" }) });
const purchases = () => h.db.tables.season_purchases as Record<string, unknown>[];
const reqStatus = () => (h.db.tables.venue_requests[0] as { status: string }).status;

function seed(status: string, pi: string | null = "pi_1") {
  h.db = makeDb({
    venue_requests: [{ id: "req1", user_id: "u1", venue_key: "v1", requested_date: "2026-11-07", start_time: "11:00:00", duration_hours: 2, status: "new" }],
    venues: [{ venue_key: "v1", name: "Hillcrest Turf" }],
    alert_subscriptions: [],
    season_purchases: [{ id: "sp1", user_id: "u1", venue_request_id: "req1", status, stripe_payment_intent_id: pi }],
  });
}

beforeEach(() => {
  h.pushed.length = 0;
  h.applyStatus = "declined";
  h.prevStatus = "new";
  h.refund.mockReset().mockResolvedValue({ id: "re_1" });
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  seed("paid");
});

describe("refundSeasonForRequest", () => {
  it("refunds the full payment with an idempotency key and marks the purchase refunded", async () => {
    const r = await refundSeasonForRequest(fakeClient(h.db) as never, "req1");
    expect(r).toEqual({ kind: "refunded", purchaseId: "sp1", userId: "u1" });
    expect(h.refund).toHaveBeenCalledWith({ payment_intent: "pi_1" }, { idempotencyKey: "season-refund:sp1" });
    expect(purchases()[0].status).toBe("refunded");
  });
  it("does nothing when the purchase is already refunded", async () => {
    seed("refunded");
    expect(await refundSeasonForRequest(fakeClient(h.db) as never, "req1")).toEqual({ kind: "already" });
    expect(h.refund).not.toHaveBeenCalled();
  });
  it("does nothing when the request has no season purchase", async () => {
    h.db.tables.season_purchases = [];
    expect(await refundSeasonForRequest(fakeClient(h.db) as never, "req1")).toEqual({ kind: "none" });
    expect(h.refund).not.toHaveBeenCalled();
  });
  it("ignores a purchase that was never paid", async () => {
    seed("pending", null);
    expect(await refundSeasonForRequest(fakeClient(h.db) as never, "req1")).toEqual({ kind: "none" });
    expect(h.refund).not.toHaveBeenCalled();
  });
  it("fails without marking refunded when Stripe errors", async () => {
    h.refund.mockRejectedValue(new Error("boom"));
    const r = await refundSeasonForRequest(fakeClient(h.db) as never, "req1");
    expect(r.kind).toBe("failed");
    expect(purchases()[0].status).toBe("paid");
  });
  it("fails when a paid purchase has no payment intent", async () => {
    seed("paid", null);
    const r = await refundSeasonForRequest(fakeClient(h.db) as never, "req1");
    expect(r.kind).toBe("failed");
    expect(h.refund).not.toHaveBeenCalled();
    expect(purchases()[0].status).toBe("paid");
  });
  it("treats charge_already_refunded as success", async () => {
    h.refund.mockRejectedValue(Object.assign(new Error("already"), { code: "charge_already_refunded" }));
    expect((await refundSeasonForRequest(fakeClient(h.db) as never, "req1")).kind).toBe("refunded");
    expect(purchases()[0].status).toBe("refunded");
  });
});

describe("PATCH decline", () => {
  it("refunds, declines and sends one plain refund push", async () => {
    const res = await PATCH(patch({ id: "req1", status: "declined" }));
    expect(res.status).toBe(200);
    expect(reqStatus()).toBe("declined");
    expect(purchases()[0].status).toBe("refunded");
    expect(h.pushed).toHaveLength(1);
    const msg = (h.pushed[0][2] as { body: string });
    expect(msg.body).toContain("Your money is on its way back");
    expect(msg.body).not.toContain("—");
  });
  it("on a refund failure shows the admin an error and leaves the request and purchase alone", async () => {
    h.refund.mockRejectedValue(new Error("boom"));
    const res = await PATCH(patch({ id: "req1", status: "declined" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/refund didn't go through/);
    expect(reqStatus()).toBe("new");
    expect(purchases()[0].status).toBe("paid");
    expect(h.pushed).toHaveLength(0);
  });
  it("an already refunded season declines normally with the usual push and no second refund", async () => {
    seed("refunded");
    const res = await PATCH(patch({ id: "req1", status: "declined" }));
    expect(res.status).toBe(200);
    expect(h.refund).not.toHaveBeenCalled();
    expect(reqStatus()).toBe("declined");
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0][2] as { body: string }).body).toContain("Try another field or time");
  });
  it("a normal request with no payment declines without touching Stripe", async () => {
    h.db.tables.season_purchases = [];
    const res = await PATCH(patch({ id: "req1", status: "declined" }));
    expect(res.status).toBe(200);
    expect(h.refund).not.toHaveBeenCalled();
    expect(reqStatus()).toBe("declined");
  });
  it("approving a paid season never refunds", async () => {
    const res = await PATCH(patch({ id: "req1", status: "approved" }));
    expect(res.status).toBe(200);
    expect(h.refund).not.toHaveBeenCalled();
    expect(purchases()[0].status).toBe("paid");
  });
});

describe("reply route decline", () => {
  it("refunds when the reply declines a paid season", async () => {
    const res = await reply(replyReq());
    expect(res.status).toBe(200);
    expect(purchases()[0].status).toBe("refunded");
    expect(h.pushed).toHaveLength(1);
  });
  it("reports a failed refund to the admin", async () => {
    h.refund.mockRejectedValue(new Error("boom"));
    const res = await reply(replyReq());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Reply saved, but the refund didn't go through/);
    expect(purchases()[0].status).toBe("paid");
  });
  it("does not refund when the reply does not decline", async () => {
    h.applyStatus = "approved";
    const res = await reply(replyReq());
    expect(res.status).toBe(200);
    expect(h.refund).not.toHaveBeenCalled();
  });
});
