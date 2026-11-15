import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPushSlotsTwin, fakeClient, type FakeDb } from "../helpers/fakeSupabase";
import { HOUR, NOW, ratingWorld } from "../helpers/ratingWorld";

const h = vi.hoisted(() => ({ db: null as unknown, sent: [] as { to: string; title: string; body: string; data: Record<string, unknown> }[] }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient: client } = await import("../helpers/fakeSupabase");
  return { getSupabaseAdmin: () => client(h.db as never) };
});

import { GET as cronGet } from "../../app/api/cron/rating-reminders/route";
import { RATING_REMINDER_BODY, RATING_REMINDER_KIND, RATING_REMINDER_TITLE, sendRatingReminders } from "../../lib/ratings/ratingReminders";

const PLAYERS = ["p1", "p2", "p3", "p4"];

function world(o: Parameters<typeof ratingWorld>[0] = {}): FakeDb {
  const db = ratingWorld({ kickoffAgo: 24 * HOUR, flag: { enabled: true, allowlist: [] }, ...o });
  db.tables.user_push_devices = [...PLAYERS, "adm"].map((id) => ({ user_id: id, expo_push_token: `ExponentPushToken[dev-${id}]`, push_notifications_enabled: true, installation_context: "standalone" }));
  db.rpcs.claim_push_slots = claimPushSlotsTwin(db, () => NOW);
  h.db = db;
  return db;
}
const run = (now = NOW) => sendRatingReminders(fakeClient(h.db as never) as unknown as SupabaseClient, now);
const recipients = () => h.sent.map((m) => m.to.replace("ExponentPushToken[dev-", "").replace("]", "")).sort();

beforeEach(() => {
  h.sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: string }) => {
      const msgs = JSON.parse(init.body) as typeof h.sent;
      h.sent.push(...msgs);
      return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }), { status: 200 });
    }),
  );
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the one reminder, 24 hours after kickoff", () => {
  it("goes to every player who still owes a rating, with plain words and the game to open", async () => {
    world();
    const r = await run();
    expect(r).toMatchObject({ considered: 4, claimed: 4, sent: 4 });
    expect(recipients()).toEqual(PLAYERS);
    const m = h.sent[0]!;
    expect(m.title).toBe(RATING_REMINDER_TITLE);
    expect(m.body).toBe(RATING_REMINDER_BODY);
    expect(m.data).toMatchObject({ kind: RATING_REMINDER_KIND, run_id: "r1", screen: "session/r1", url: "ctpickup://session/r1" });
    expect(JSON.stringify(h.sent)).not.toMatch(/—|tier|wave|score/i);
  });

  it("never a second one: later runs, the next hour, the next day, and two runs at once all send nothing more", async () => {
    world();
    await run();
    expect(h.sent).toHaveLength(4);
    await run(NOW + HOUR);
    await run(NOW + 20 * HOUR);
    await Promise.all([run(NOW + 21 * HOUR), run(NOW + 21 * HOUR)]);
    expect(h.sent).toHaveLength(4);
    expect((h.db as FakeDb).tables.push_ledger).toHaveLength(4);
  });

  it("not before 24 hours: a minute early sends nothing, and the first run after 24 hours sends it", async () => {
    world({ kickoffAgo: 24 * HOUR - 60_000 });
    expect((await run()).sent).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect((await run(NOW + 2 * 60_000)).sent).toBe(4);
  });

  it("not once the requirement has expired at 72 hours after kickoff", async () => {
    world({ kickoffAgo: 72 * HOUR });
    expect((await run()).sent).toBe(0);
    world({ kickoffAgo: 72 * HOUR - 60_000 });
    expect((await run()).sent).toBe(4);
  });

  it("only while the rating is still pending: a player who already voted is not reminded", async () => {
    const db = world();
    db.tables.peer_votes!.push({ session_id: "ts1", voter_id: "p2", votee_id: "p1", rank: 1 });
    await run();
    expect(recipients()).toEqual(["p1", "p3", "p4"]);
  });

  it("a rating that gets submitted between runs cancels the reminder before it is ever sent", async () => {
    const db = world({ kickoffAgo: 23 * HOUR });
    await run();
    db.tables.peer_votes!.push(...PLAYERS.map((id) => ({ session_id: "ts1", voter_id: id, votee_id: "x", rank: 1 })));
    await run(NOW + 2 * HOUR);
    expect(h.sent).toHaveLength(0);
  });

  it("not for a game with 3 players, for the host, for a tournament match, or for someone who did not attend", async () => {
    world({ players: 3 });
    expect((await run()).sent).toBe(0);
    const db = world({ extra: { tournament_match_runs: [{ match_id: "m", run_id: "r1" }] } });
    expect((await run()).sent).toBe(0);
    db.tables.tournament_match_runs = [];
    db.tables.pickup_run_attendance!.push({ run_id: "r1", user_id: "p3", attended: false });
    db.tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "host1", status: "confirmed" });
    await run();
    expect(recipients()).toEqual(["p1", "p2", "p4"]);
  });

  it("admins are exempt and never reminded", async () => {
    const db = world();
    db.tables.pickup_run_rsvps!.push({ run_id: "r1", user_id: "adm", status: "confirmed" });
    await run();
    expect(recipients()).toEqual(PLAYERS);
  });
});

describe("the flag", () => {
  it("off: nothing is sent and nothing is claimed", async () => {
    const db = world({ flag: { enabled: false, allowlist: [] } });
    expect(await run()).toEqual({ considered: 0, claimed: 0, sent: 0 });
    db.tables.app_flags = [];
    expect(await run()).toEqual({ considered: 0, claimed: 0, sent: 0 });
    expect(h.sent).toHaveLength(0);
    expect(db.tables.push_ledger ?? []).toHaveLength(0);
  });

  it("on for one account first: only that player is reminded", async () => {
    world({ flag: { enabled: false, allowlist: ["p3"] } });
    await run();
    expect(recipients()).toEqual(["p3"]);
  });
});

describe("the player's own notification rules", () => {
  it("quiet hours: skipped without using up the reminder, then sent once when the quiet hours end", async () => {
    const db = world();
    // 2:00 PM Eastern now; p1's quiet hours are 1 PM to 3 PM.
    Object.assign(db.tables.profiles!.find((p) => p.id === "p1")!, { quiet_hours_enabled: true, quiet_hours_start: 13 * 60, quiet_hours_end: 15 * 60, quiet_hours_tz: "America/New_York" });
    await run();
    expect(recipients()).toEqual(["p2", "p3", "p4"]);
    expect((db.tables.push_ledger ?? []).filter((l) => l.user_id === "p1")).toHaveLength(0);

    await run(NOW + 2 * HOUR); // 4:00 PM Eastern
    expect(recipients()).toEqual(["p1", "p2", "p3", "p4"]);
    await run(NOW + 3 * HOUR);
    expect(h.sent).toHaveLength(4);
  });

  it("reminders switched off in Settings: not sent, and never claimed", async () => {
    const db = world();
    db.tables.profiles!.find((p) => p.id === "p4")!.push_cat_reminders = false;
    await run();
    expect(recipients()).toEqual(["p1", "p2", "p3"]);
    expect((db.tables.push_ledger ?? []).some((l) => l.user_id === "p4")).toBe(false);
  });

  it("with no push ledger available, nothing is sent rather than risking a second reminder", async () => {
    const db = world();
    delete db.rpcs.claim_push_slots;
    expect((await run()).sent).toBe(0);
    expect(h.sent).toHaveLength(0);
  });
});

describe("the hourly cron route", () => {
  const call = (auth?: string) => cronGet(new Request("https://site.test/api/cron/rating-reminders", auth ? { headers: { authorization: auth } } : undefined));

  it("needs the cron secret", async () => {
    world();
    expect((await call()).status).toBe(500);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("runs the reminders and reports the count", async () => {
    world();
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const res = await call("Bearer s3cret");
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, considered: 4, sent: 4 });
  });

  it("is on the hourly schedule", async () => {
    const cfg = JSON.parse((await import("node:fs")).readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(cfg.crons.find((c) => c.path === "/api/cron/rating-reminders")?.schedule).toMatch(/^\d+ \* \* \* \*$/);
  });
});
