import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cancel: vi.fn(), expire: vi.fn() }));

vi.mock("stripe", () => ({
  default: class {
    subscriptions = { cancel: h.cancel };
    checkout = { sessions: { expire: h.expire } };
  },
}));
vi.mock("@/lib/plans/stripePlans", () => ({ assertPlansTestKey: () => "sk_test_fake" }));
vi.mock("@/lib/server/runtimeClients", () => ({ getStripePickup: () => ({}), getStripeTournament: () => ({}) }));
vi.mock("@/lib/auth/invalidateUserSessions", () => ({ invalidateUserSessions: async () => ({ ok: true }) }));
vi.mock("@/lib/account/anonymizeUserRecords", () => ({ anonymizePlatformPayments: async () => 0, anonymizePickupRsvps: async () => ({ kept: 0, deleted: 0 }) }));
vi.mock("@/lib/account/accountDeletionPlan", async (orig) => ({
  ...(await orig<typeof import("@/lib/account/accountDeletionPlan")>()),
  loadUpcomingCommitments: async () => ({ hostedRuns: [], playerSpots: [] }),
  previewFromCommitments: () => ({ confirmation_required: false }),
  cancelHostedRunsForDeletion: async () => undefined,
  leaveSpotsForDeletion: async () => [],
}));

import { AccountDeletionError } from "@/lib/account/accountDeletionPlan";
import { deleteUserAccount } from "@/lib/account/deleteUserAccount";
import { cancelPlansForUser } from "@/lib/plans/cancelUserPlans";

type Row = Record<string, unknown>;

/** Any table answers "no rows"; plan_subscriptions and season_purchases hold what the test gives them. */
function makeSvc(data: { plan_subscriptions?: Row[]; season_purchases?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { plan_subscriptions: data.plan_subscriptions ?? [], season_purchases: data.season_purchases ?? [] };
  const deletedUsers: string[] = [];
  const profileDeletes: string[] = [];
  const from = (name: string) => {
    const f: [string, unknown][] = [];
    let deleting = false;
    const rows = () => (tables[name] ?? []).filter((r) => f.every(([c, v]) => r[c] === v));
    const q: Record<string, unknown> = {};
    const chain = new Proxy(q, {
      get(_t, prop: string) {
        if (prop === "then")
          return (res: (x: unknown) => unknown) => {
            if (deleting && name === "profiles") profileDeletes.push(String(f[0]?.[1]));
            return res({ data: structuredClone(rows()), error: null });
          };
        if (prop === "eq") return (c: string, v: unknown) => (f.push([c, v]), chain);
        if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
        if (prop === "update")
          return (patch: Row) => ({
            eq: async (c: string, v: unknown) => {
              for (const r of tables[name] ?? []) if (r[c] === v) Object.assign(r, patch);
              return { error: null };
            },
          });
        if (prop === "delete")
          return () => {
            deleting = true;
            return chain;
          };
        return () => chain;
      },
    });
    return chain;
  };
  const svc = {
    from,
    rpc: async () => ({ data: true, error: null }),
    auth: { admin: { deleteUser: async (id: string) => (deletedUsers.push(id), { error: null }) } },
  };
  return { svc: svc as never, tables, deletedUsers, profileDeletes };
}

beforeEach(() => {
  h.cancel.mockReset().mockResolvedValue({});
  h.expire.mockReset().mockResolvedValue({});
});

describe("cancelPlansForUser", () => {
  it("cancels each live subscription in Stripe and marks it canceled", async () => {
    const { svc, tables } = makeSvc({
      plan_subscriptions: [
        { user_id: "u1", stripe_subscription_id: "sub_1", status: "active" },
        { user_id: "u1", stripe_subscription_id: "sub_old", status: "canceled" },
        { user_id: "u2", stripe_subscription_id: "sub_other", status: "active" },
      ],
    });
    const res = await cancelPlansForUser(svc, "u1");
    expect(res).toEqual({ subscriptionsCanceled: 1, purchasesCanceled: 0 });
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.cancel).toHaveBeenCalledWith("sub_1");
    expect(tables.plan_subscriptions!.find((r) => r.stripe_subscription_id === "sub_1")!.status).toBe("canceled");
    expect(tables.plan_subscriptions!.find((r) => r.stripe_subscription_id === "sub_other")!.status).toBe("active"); // someone else's
  });

  it("expires an unpaid season checkout and marks it canceled; paid ones are left as the record they are", async () => {
    const { svc, tables } = makeSvc({
      season_purchases: [
        { id: "p1", user_id: "u1", status: "pending", stripe_checkout_session_id: "cs_1" },
        { id: "p2", user_id: "u1", status: "paid", stripe_checkout_session_id: "cs_2" },
      ],
    });
    expect(await cancelPlansForUser(svc, "u1")).toEqual({ subscriptionsCanceled: 0, purchasesCanceled: 1 });
    expect(h.expire).toHaveBeenCalledTimes(1);
    expect(h.expire).toHaveBeenCalledWith("cs_1");
    expect(tables.season_purchases!.find((r) => r.id === "p1")!.status).toBe("canceled");
    expect(tables.season_purchases!.find((r) => r.id === "p2")!.status).toBe("paid");
  });

  it("treats 'already canceled / no such subscription' as success", async () => {
    h.cancel.mockRejectedValue(Object.assign(new Error("No such subscription: 'sub_1'"), { code: "resource_missing" }));
    const { svc, tables } = makeSvc({ plan_subscriptions: [{ user_id: "u1", stripe_subscription_id: "sub_1", status: "active" }] });
    await expect(cancelPlansForUser(svc, "u1")).resolves.toMatchObject({ subscriptionsCanceled: 1 });
    expect(tables.plan_subscriptions![0]!.status).toBe("canceled");
  });

  it("throws on a real Stripe failure and leaves the local row alone", async () => {
    h.cancel.mockRejectedValue(new Error("Stripe is down"));
    const { svc, tables } = makeSvc({ plan_subscriptions: [{ user_id: "u1", stripe_subscription_id: "sub_1", status: "active" }] });
    await expect(cancelPlansForUser(svc, "u1")).rejects.toMatchObject({ code: "billing_cancel_failed", status: 502 });
    expect(tables.plan_subscriptions![0]!.status).toBe("active");
  });

  it("never creates a Stripe client for a user with no plans", async () => {
    const { svc } = makeSvc();
    const make = vi.fn();
    expect(await cancelPlansForUser(svc, "u1", make)).toEqual({ subscriptionsCanceled: 0, purchasesCanceled: 0 });
    expect(make).not.toHaveBeenCalled();
  });
});

describe("deleteUserAccount and Fields billing", () => {
  it("cancels the Concierge subscription in Stripe, then deletes the user", async () => {
    const { svc, deletedUsers, profileDeletes } = makeSvc({ plan_subscriptions: [{ user_id: "u1", stripe_subscription_id: "sub_1", status: "active" }] });
    await deleteUserAccount(svc, "u1", "a@b.c");
    expect(h.cancel).toHaveBeenCalledWith("sub_1");
    expect(deletedUsers).toEqual(["u1"]);
    expect(profileDeletes).toEqual(["u1"]);
  });

  it("a Stripe failure blocks the deletion: nothing is deleted", async () => {
    h.cancel.mockRejectedValue(new Error("Stripe is down"));
    const { svc, deletedUsers, profileDeletes } = makeSvc({ plan_subscriptions: [{ user_id: "u1", stripe_subscription_id: "sub_1", status: "active" }] });
    const err = await deleteUserAccount(svc, "u1", "a@b.c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountDeletionError);
    expect(err).toMatchObject({ code: "billing_cancel_failed", status: 502 });
    expect(deletedUsers).toEqual([]);
    expect(profileDeletes).toEqual([]);
  });

  it("a user with no subscription still deletes, without touching Stripe", async () => {
    const { svc, deletedUsers } = makeSvc();
    await deleteUserAccount(svc, "u1", "a@b.c");
    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
    expect(deletedUsers).toEqual(["u1"]);
  });

  it("an unpaid season checkout is expired before the user is deleted", async () => {
    const { svc, deletedUsers } = makeSvc({ season_purchases: [{ id: "p1", user_id: "u1", status: "pending", stripe_checkout_session_id: "cs_1" }] });
    await deleteUserAccount(svc, "u1", "a@b.c");
    expect(h.expire).toHaveBeenCalledWith("cs_1");
    expect(deletedUsers).toEqual(["u1"]);
  });
});
