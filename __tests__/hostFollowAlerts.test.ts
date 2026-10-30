import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimPushSlotsTwin, fakeClient, makeDb, type FakeDb } from "./helpers/fakeSupabase";

const sent = vi.hoisted(() => [] as { ids: string[]; payload: { title: string; body: string; data?: Record<string, unknown> } }[]);
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_a: unknown, ids: string[], payload: { title: string; body: string; data?: Record<string, unknown> }) => {
    sent.push({ ids, payload });
    return { tokens: ids.length, batches: [] };
  },
}));

import { hostNewRunCopy, notifyFollowersOfHostRun } from "@/lib/pickup/notifyFollowersOfHostRun";
import { pushCategoryFor } from "@/lib/push/pushPolicy";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const F1 = "00000000-0000-4000-8000-0000000000b1";
const F2 = "00000000-0000-4000-8000-0000000000b2";
const F3 = "00000000-0000-4000-8000-0000000000b3";
const OTHER_HOST = "00000000-0000-4000-8000-0000000000a2";

let now = Date.parse("2026-10-28T15:00:00Z");

function world(flag: { enabled: boolean; allowlist?: string[] } | null = { enabled: true }): FakeDb {
  const db = makeDb({
    app_flags: flag ? [{ key: "host_follow_alerts", ...flag }] : [],
    player_follows: [
      { follower_id: F1, following_id: HOST },
      { follower_id: F2, following_id: HOST },
      { follower_id: F3, following_id: HOST },
      { follower_id: F1, following_id: OTHER_HOST },
    ],
    profiles: [
      { id: HOST, approved: true, is_admin: false },
      { id: F1, approved: true, is_admin: false },
      { id: F2, approved: true, is_admin: false },
      { id: F3, approved: false, is_admin: false },
    ],
  });
  db.rpcs.claim_push_slots = claimPushSlotsTwin(db, () => now);
  return db;
}

const run = (id = "run-1", over: Partial<{ inviteOnly: boolean; region: string | null }> = {}) => ({ id, start_at: "2026-10-30T22:00:00Z", time_tbd: false, inviteOnly: false, region: "CT", ...over });
const call = (db: FakeDb, r = run(), skip: string[] = []) => notifyFollowersOfHostRun(fakeClient(db) as never, { hostId: HOST, hostName: "Sam", run: r, skip });

beforeEach(() => {
  sent.length = 0;
  now = Date.parse("2026-10-28T15:00:00Z");
});

describe("host follow alerts", () => {
  it("pushes approved followers of the host, with a deep link to the game", async () => {
    const pushed = await call(world());
    expect(pushed.sort()).toEqual([F1, F2]); // F3 is not approved
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: "Sam posted a game", body: "Fri 6:00 PM in CT. You follow Sam." });
    expect(sent[0]!.payload.data).toMatchObject({ kind: "host_new_run", run_id: "run-1", screen: "session/run-1" });
  });
  it("does nothing while the flag is off, and only reaches the allowlist when partly on", async () => {
    expect(await call(world({ enabled: false }))).toEqual([]);
    expect(await call(world(null))).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(await call(world({ enabled: false, allowlist: [F2] }))).toEqual([F2]);
  });
  it("fails closed when the flag cannot be read", async () => {
    const db = world();
    db.failTables.app_flags = "boom";
    expect(await call(db)).toEqual([]);
  });
  it("sends one push per follower per host per day, even for a second game", async () => {
    const db = world();
    expect((await call(db, run("run-1"))).sort()).toEqual([F1, F2]);
    now += 3 * 3_600_000;
    expect(await call(db, run("run-2"))).toEqual([]);
    now += 22 * 3_600_000; // 25 hours after the first
    expect((await call(db, run("run-3"))).sort()).toEqual([F1, F2]);
  });
  it("the cap is per host: following two hosts allows one push from each", async () => {
    const db = world();
    await call(db, run("run-1"));
    sent.length = 0;
    const other = await notifyFollowersOfHostRun(fakeClient(db) as never, { hostId: OTHER_HOST, hostName: "Pat", run: run("run-9"), skip: [] });
    expect(other).toEqual([F1]);
  });
  it("never announces an invite-only game, the host, or players already pushed", async () => {
    expect(await call(world(), run("run-1", { inviteOnly: true }))).toEqual([]);
    expect(await call(world(), run("run-1"), [F1])).toEqual([F2]);
  });
  it("never throws and sends nothing when the follow table cannot be read", async () => {
    const db = world();
    db.failTables.player_follows = "boom";
    await expect(call(db)).resolves.toEqual([]);
    expect(sent).toHaveLength(0);
  });
  it("is a game notification, so the games switch and quiet hours apply, and the copy is plain", () => {
    expect(pushCategoryFor({ kind: "host_new_run" })).toBe("games");
    const c = hostNewRunCopy("Sam", "Fri 6:00 PM", null);
    expect(`${c.title} ${c.body}`).not.toMatch(/—|–|tier|wave/i);
    expect(c.body).toBe("Fri 6:00 PM. You follow Sam.");
  });
});
