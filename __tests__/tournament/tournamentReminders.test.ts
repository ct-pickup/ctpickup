import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPushSlotsTwin, fakeClient, makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, sent: [] as { to: string; title: string; body: string; data: Record<string, unknown> }[] }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient: client } = await import("../helpers/fakeSupabase");
  return { getSupabaseAdmin: () => client(h.db as never) };
});

import { GET as cronGet } from "../../app/api/cron/tournament-reminders/route";
import {
  TOURNAMENT_REMINDER_BUCKET,
  TOURNAMENT_REMINDER_KIND,
  TOURNAMENT_REMINDER_TITLE,
  sendTournamentStartReminders,
  startTimeText,
  tournamentReminderBody,
} from "../../lib/tournament/tournamentReminders";

/** Saturday 2026-11-21, 2:00 PM Eastern (19:00 UTC) is the tournament's start. */
const START = Date.parse("2026-11-21T19:00:00Z");
const HOUR = 3_600_000;
const NOW = START - 24 * HOUR;
const T = "tour-1";

function world(o: { slug?: string; active?: boolean; canceled?: boolean; start?: number | null; finalDone?: boolean } = {}): FakeDb {
  const db = makeDb({
    tournaments: [{ id: T, title: "Fall Classic", slug: o.slug ?? "fall-classic", is_active: o.active ?? true, canceled_at: o.canceled ? "2026-11-01T00:00:00Z" : null, start_at: o.start === null ? null : new Date(o.start ?? START).toISOString(), start_reminder_sent_at: null }],
    tournament_captains: [
      { id: "c1", tournament_id: T, user_id: "u1", status: "payment_received" },
      { id: "c2", tournament_id: T, user_id: "u2", status: "confirmed" },
      { id: "c3", tournament_id: T, user_id: "u3", status: "claim_submitted" }, // not paid
      { id: "c4", tournament_id: T, user_id: "u7", status: "payment_pending" }, // not paid
    ],
    tournament_roster: [
      { id: "r1", tournament_id: T, captain_id: "c1", user_id: "u4", status: "accepted" },
      { id: "r2", tournament_id: T, captain_id: "c1", user_id: "u5", status: "invited" }, // not accepted
      { id: "r3", tournament_id: T, captain_id: "c3", user_id: "u6", status: "accepted" }, // accepted, but the team never paid
      { id: "r4", tournament_id: T, captain_id: "c2", user_id: "u8", status: "declined" },
    ],
    tournament_matches: o.finalDone ? [{ id: "f", tournament_id: T, stage: "final", completed_at: "2026-11-21T22:00:00Z" }] : [],
    profiles: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"].map((id) => ({ id, is_admin: false })),
    user_push_devices: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"].map((id) => ({ user_id: id, expo_push_token: `ExponentPushToken[dev-${id}]`, push_notifications_enabled: true, installation_context: "standalone" })),
  });
  db.rpcs.claim_push_slots = claimPushSlotsTwin(db, () => NOW);
  h.db = db;
  return db;
}
const run = (now = NOW) => sendTournamentStartReminders(fakeClient(h.db as never) as unknown as SupabaseClient, now);
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

describe("what the reminder says and who gets it", () => {
  it("goes to paid captains and players who accepted a place on a paid team, and to nobody else", async () => {
    world();
    const r = await run();
    expect(r).toMatchObject({ tournaments: 1, considered: 3, claimed: 3, sent: 3 });
    expect(recipients()).toEqual(["u1", "u2", "u4"]);
  });

  it("says exactly this, with the start time in Eastern time", async () => {
    world();
    await run();
    const m = h.sent[0]!;
    expect(m.title).toBe("Tournament starts soon");
    expect(m.title).toBe(TOURNAMENT_REMINDER_TITLE);
    expect(m.body).toBe("Fall Classic starts Sat, Nov 21 at 2:00 PM ET.");
    expect(m.data).toMatchObject({ kind: TOURNAMENT_REMINDER_KIND, tournament_id: T });
    expect(startTimeText("2026-11-21T19:00:00Z")).toBe("Sat, Nov 21 at 2:00 PM ET");
    expect(startTimeText("2026-07-04T23:30:00Z")).toBe("Sat, Jul 4 at 7:30 PM ET"); // daylight time
    expect(tournamentReminderBody("  ", "2026-11-21T19:00:00Z")).toBe("Your tournament starts Sat, Nov 21 at 2:00 PM ET.");
    expect(JSON.stringify(h.sent)).not.toMatch(/—/);
  });
});

describe("2. exactly once", () => {
  it("a second run, the next hour, later hours and two runs at the same moment all send nothing more", async () => {
    const db = world();
    await run();
    expect(h.sent).toHaveLength(3);
    await run(NOW);
    await run(NOW + HOUR);
    await run(NOW + 5 * HOUR);
    await Promise.all([run(NOW + 6 * HOUR), run(NOW + 6 * HOUR)]);
    expect(h.sent).toHaveLength(3);
    expect(db.tables.push_ledger).toHaveLength(3);
    expect((db.tables.push_ledger ?? []).every((l) => l.bucket === TOURNAMENT_REMINDER_BUCKET && l.dedupe_key === `${TOURNAMENT_REMINDER_BUCKET}:${T}`)).toBe(true);
  });

  it("with no push ledger it sends nothing at all (never risk a second one)", async () => {
    const db = world();
    delete db.rpcs.claim_push_slots;
    const r = await run();
    expect(h.sent).toHaveLength(0);
    expect(r.sent).toBe(0);
  });

  it("a player who joins the team later still gets exactly one, and the first three do not get a second", async () => {
    const db = world();
    await run();
    db.tables.tournament_roster!.push({ id: "r9", tournament_id: T, captain_id: "c2", user_id: "u9", status: "accepted" });
    db.tables.user_push_devices!.push({ user_id: "u9", expo_push_token: "ExponentPushToken[dev-u9]", push_notifications_enabled: true, installation_context: "standalone" });
    db.tables.profiles!.push({ id: "u9", is_admin: false });
    await run(NOW + HOUR);
    expect(recipients()).toEqual(["u1", "u2", "u4", "u9"]);
  });
});

describe("2. the tournaments it must not touch", () => {
  it("a test- tournament sends nothing, and claims nothing", async () => {
    const db = world({ slug: "test-bracket-demo" });
    const r = await run();
    expect(h.sent).toEqual([]);
    expect(r).toMatchObject({ tournaments: 0, claimed: 0, sent: 0 });
    expect(db.tables.push_ledger ?? []).toEqual([]);
    expect((db.rpcCalls ?? []).filter((c) => c.name === "claim_push_slots")).toEqual([]);
  });

  it("is case blind about the test- prefix", async () => {
    world({ slug: "TEST-Demo" });
    await run();
    expect(h.sent).toEqual([]);
  });

  it("an inactive tournament, a canceled one and one that is already finished send nothing", async () => {
    world({ active: false });
    await run();
    world({ canceled: true });
    await run();
    world({ finalDone: true });
    await run();
    expect(h.sent).toEqual([]);
  });

  it("no start time, a start time in the past, and a start more than 25 hours away send nothing", async () => {
    world({ start: null });
    await run();
    world();
    await run(START + HOUR);
    world();
    await run(START - 26 * HOUR);
    expect(h.sent).toEqual([]);
  });

  it("the window: nothing at 26 hours, the first run inside 25 hours sends, and nothing in the last 3 hours", async () => {
    world();
    await run(START - 26 * HOUR);
    expect(h.sent).toHaveLength(0);
    await run(START - 24.5 * HOUR);
    expect(h.sent).toHaveLength(3);
    world();
    await run(START - 2 * HOUR);
    expect(h.sent).toHaveLength(3); // nothing new: 2 hours before the start is too late
  });
});

describe("2. quiet hours", () => {
  it("a player in quiet hours is skipped without using up their reminder, and gets it once when the quiet hours end", async () => {
    const db = world();
    // Start is Saturday 2 PM ET, so 24 hours before is Friday 2 PM ET. u1's quiet hours are 1 PM to 3 PM Eastern.
    Object.assign(db.tables.profiles!.find((p) => p.id === "u1")!, { quiet_hours_enabled: true, quiet_hours_start: 13 * 60, quiet_hours_end: 15 * 60, quiet_hours_tz: "America/New_York" });
    await run(NOW);
    expect(recipients()).toEqual(["u2", "u4"]);
    expect((db.tables.push_ledger ?? []).map((l) => l.user_id).sort()).toEqual(["u2", "u4"]);
    await run(NOW + 2 * HOUR); // 4 PM: quiet hours over
    expect(recipients()).toEqual(["u1", "u2", "u4"]);
    await run(NOW + 3 * HOUR);
    expect(h.sent).toHaveLength(3);
  });

  it("a player who switched reminders off is never sent one and never has a slot claimed", async () => {
    const db = world();
    Object.assign(db.tables.profiles!.find((p) => p.id === "u2")!, { push_cat_reminders: false });
    await run();
    expect(recipients()).not.toContain("u2");
  });
});

describe("2. the cron route is authenticated like the other crons", () => {
  const call = (auth?: string) => cronGet(new Request("https://site.test/api/cron/tournament-reminders", { headers: auth ? { authorization: auth } : {} }));

  it("500 when CRON_SECRET is not configured, 401 without or with a wrong bearer, 200 with the right one", async () => {
    world();
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer x")).status).toBe(500);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(h.sent).toHaveLength(0);
    const ok = await call("Bearer s3cret");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("2. it is scheduled", () => {
  it("vercel.json runs it hourly, at a minute that is not one of the other crons'", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    const mine = cfg.crons.filter((c) => c.path === "/api/cron/tournament-reminders");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.schedule).toMatch(/^\d{1,2} \* \* \* \*$/);
    const others = cfg.crons.filter((c) => c.path !== mine[0]!.path && /^\d{1,2} \* \* \* \*$/.test(c.schedule)).map((c) => c.schedule);
    expect(others).not.toContain(mine[0]!.schedule);
  });
});
