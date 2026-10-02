import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeResultsDb } from "../results/fakeResultsDb";

const h = vi.hoisted(() => ({
  db: null as unknown as import("../results/fakeResultsDb").FakeResultsDb,
  pushes: [] as { userIds: string[]; kind: string }[],
  settled: [] as string[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, userIds: string[], msg: { data?: { kind?: string } }) => {
    h.pushes.push({ userIds, kind: msg.data?.kind ?? "voting" });
    return { tokens: userIds.length, batches: [] };
  },
}));
vi.mock("@/lib/pickup/autoSettleSession", () => ({
  autoSettleTierSession: async (_admin: unknown, id: string) => {
    h.settled.push(id);
    return { settled: true };
  },
}));
vi.mock("@/lib/pickup/pickupInvites", () => ({
  insertInvitesForTierRanks: async () => ({ ok: true, newlyInvited: [{ user_id: "invitee-1" }] }),
  sendPickupInviteSms: async () => undefined,
}));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({
  sendPickupInvitePush: async (_admin: unknown, opts: { userIds: string[]; emergency?: boolean }) => {
    h.pushes.push({ userIds: opts.userIds, kind: opts.emergency ? "last_call" : "invite" });
  },
  sendPickupPriorWaveReinvitePush: async () => undefined,
}));
vi.mock("@/lib/chat/runBanterRoom", () => ({ findRunBanterRoom: async () => null }));
vi.mock("@/lib/pickup/pickupRunWavePostgrest", () => ({
  updatePickupRunWaveSchedule: async (
    admin: FakeResultsDb,
    patch: { run_id: string; next_wave_at: string | null; wave_state: unknown },
  ) => {
    const row = admin.rows("pickup_runs").find((r) => r.id === patch.run_id)!;
    Object.assign(row, { next_wave_at: patch.next_wave_at, wave_state: patch.wave_state });
    return { ok: true };
  },
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { POST as checkVotingPOST } from "@/app/api/sessions/check-voting/route";
import { processAutoPickupRun } from "@/lib/pickup/autoRunCheckpoints";
import { realKickoffMs } from "@/lib/pickup/runScheduling";
import {
  dropDueRateRemindersForTbdRuns,
  ensureUpcomingSessionRateReminders,
  promotePlanningRunsPastStart,
  SESSION_RATE_REMINDER_KIND,
} from "@/lib/pickup/sessionLifecycle";
import { processDueWaveForRun, type PickupRunWaveRow } from "@/lib/pickup/waveInviteSystem";

const RUN = "11111111-1111-4111-8111-111111111111";
const PLAYER = "player-1";
const HOST = "host-1";
/** Saturday Oct 10, 2026: noon Eastern (the TBD placeholder) is 16:00Z; "now" is 3pm Eastern. */
const NOON_ET = "2026-10-10T16:00:00.000Z";
const NOW = "2026-10-10T19:00:00.000Z";

const db = () => h.db as unknown as SupabaseClient;
const run = () => h.db.rows("pickup_runs").find((r) => r.id === RUN)!;
const rateReminders = () =>
  h.db.rows("pickup_push_scheduled").filter((r) => r.run_id === RUN && r.kind === SESSION_RATE_REMINDER_KIND);

function seedRun(fields: Record<string, unknown>) {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Saturday run",
    status: "planning",
    start_at: NOON_ET,
    time_tbd: true,
    created_by: HOST,
    voting_notif_sent: false,
    tier_session_id: "ts-1",
    ...fields,
  });
  h.db.rows("pickup_run_rsvps").push({ id: "rsvp-1", run_id: RUN, user_id: PLAYER, status: "confirmed" });
}

function setRealTime(startAt: string) {
  Object.assign(run(), { start_at: startAt, time_tbd: false });
}

function checkVoting() {
  return checkVotingPOST(
    new Request("http://test.local/api/sessions/check-voting", {
      method: "POST",
      headers: { authorization: `Bearer ${PLAYER}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN }),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeResultsDb();
  h.pushes = [];
  h.settled = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("realKickoffMs", () => {
  it("has no kickoff for a TBD run and the start_at otherwise", () => {
    expect(realKickoffMs({ start_at: NOON_ET, time_tbd: true })).toBeNull();
    expect(realKickoffMs({ start_at: NOON_ET, time_tbd: false })).toBe(Date.parse(NOON_ET));
    expect(realKickoffMs({ start_at: NOON_ET })).toBe(Date.parse(NOON_ET));
    expect(realKickoffMs({ start_at: null })).toBeNull();
  });
});

describe("automatic status change past start", () => {
  it("does not start a TBD run on its date after noon", async () => {
    seedRun({});
    expect(await promotePlanningRunsPastStart(db())).toEqual({ updated: 0 });
    expect(await promotePlanningRunsPastStart(db(), { runId: RUN })).toEqual({ updated: 0 });
    expect(run().status).toBe("planning");
  });

  it("starts the same run once a real time in the past is set", async () => {
    seedRun({});
    await promotePlanningRunsPastStart(db());
    setRealTime("2026-10-10T17:00:00.000Z");
    expect(await promotePlanningRunsPastStart(db())).toEqual({ updated: 1 });
    expect(run().status).toBe("active");
  });

  it("starts a non-TBD run as before, and only once kickoff has passed", async () => {
    seedRun({ time_tbd: false, start_at: "2026-10-10T20:00:00.000Z" });
    expect((await promotePlanningRunsPastStart(db())).updated).toBe(0);
    vi.setSystemTime(new Date("2026-10-10T20:01:00.000Z"));
    expect((await promotePlanningRunsPastStart(db())).updated).toBe(1);
    expect(run().status).toBe("active");
  });

  it("treats every run as not TBD when the time_tbd column is missing", async () => {
    h.db.missingColumns.pickup_runs = ["time_tbd"];
    seedRun({});
    delete run().time_tbd;
    expect((await promotePlanningRunsPastStart(db())).updated).toBe(1);
    expect(run().status).toBe("active");
  });
});

describe("auto checkpoints (low-turnout cancel / finalize)", () => {
  it("neither finalizes nor cancels a TBD run with no slots, then runs once a real time is set", async () => {
    seedRun({ auto_managed: true, run_type: "public", capacity: 10 });
    await processAutoPickupRun(db(), RUN);
    expect(run().status).toBe("planning");
    expect(run().auto_cp_1h_at).toBeUndefined();
    expect(run().auto_cp_24h_at).toBeUndefined();

    setRealTime("2026-10-10T19:30:00.000Z");
    await processAutoPickupRun(db(), RUN);
    expect(run().auto_cp_24h_at).toBeTruthy();
    expect(run().auto_cp_1h_at).toBeTruthy();
    expect(run().status).toBe("canceled");
    expect(run().canceled_reason).toBe("auto_below_threshold_1h");
  });

  it("clears time_tbd when the 1h checkpoint finalizes a TBD run onto a slot", async () => {
    seedRun({ auto_managed: true, run_type: "public", capacity: 2 });
    h.db.rows("pickup_run_time_slots").push({ id: "slot-1", run_id: RUN, start_at: "2026-10-10T19:30:00.000Z" });
    for (const u of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      h.db.rows("pickup_run_availability").push({ run_id: RUN, user_id: u, slot_id: "slot-1", state: "available" });
    }
    await processAutoPickupRun(db(), RUN);
    expect(run().status).toBe("active");
    expect(run().start_at).toBe("2026-10-10T19:30:00.000Z");
    expect(run().time_tbd).toBe(false);
  });
});

describe("kickoff reminder (wave 4 last call, 2h before kickoff)", () => {
  const waveRow = (): PickupRunWaveRow =>
    ({
      ...run(),
      wave_state: {
        wave1_sent_at: "2026-10-08T12:00:00.000Z",
        wave2_sent_at: "2026-10-09T12:00:00.000Z",
        wave3_sent_at: "2026-10-10T12:00:00.000Z",
      },
    }) as unknown as PickupRunWaveRow;

  it("defers a TBD run without a last-call push, then sends it once a real time is set", async () => {
    seedRun({ run_type: "select", capacity: 0, next_wave_at: NOW });
    const deferred = await processDueWaveForRun(db(), waveRow(), Date.now());
    expect(deferred?.action).toBe("deferred_wave4_time_tbd");
    expect(Date.parse(String(run().next_wave_at))).toBeGreaterThan(Date.now());
    expect(h.pushes).toEqual([]);
    expect(h.db.rows("pickup_run_updates")).toEqual([]);

    setRealTime("2026-10-10T20:30:00.000Z");
    const fired = await processDueWaveForRun(db(), waveRow(), Date.now());
    expect(fired?.action).toBe("opened_wave_4");
    expect(h.pushes).toEqual([{ userIds: ["invitee-1"], kind: "last_call" }]);
  });

  it("sends a non-TBD run's last call as before", async () => {
    seedRun({ run_type: "select", capacity: 0, time_tbd: false, start_at: "2026-10-10T20:30:00.000Z" });
    const fired = await processDueWaveForRun(db(), waveRow(), Date.now());
    expect(fired?.action).toBe("opened_wave_4");
  });
});

describe("rating reminders", () => {
  it("queues no rate reminder for a TBD run and drops unsent ones", async () => {
    seedRun({});
    h.db.rows("pickup_push_scheduled").push({
      id: "old-1",
      user_id: PLAYER,
      run_id: RUN,
      kind: SESSION_RATE_REMINDER_KIND,
      send_at: "2026-10-10T16:30:00.000Z",
      sent_at: null,
    });
    const res = await ensureUpcomingSessionRateReminders(db());
    expect(res.scheduled).toBe(0);
    expect(rateReminders()).toEqual([]);
  });

  it("drops a due rate reminder for a TBD run at send time but keeps other kinds", async () => {
    seedRun({});
    const due = [
      { id: "r-1", user_id: PLAYER, run_id: RUN, kind: SESSION_RATE_REMINDER_KIND, send_at: NOON_ET, sent_at: null },
      { id: "w-1", user_id: PLAYER, run_id: RUN, kind: "waitlist_offer_expiring", send_at: NOON_ET, sent_at: null },
    ];
    h.db.rows("pickup_push_scheduled").push(...due.map((r) => ({ ...r })));
    const dropped = await dropDueRateRemindersForTbdRuns(db(), due);
    expect([...dropped]).toEqual(["r-1"]);
    expect(h.db.rows("pickup_push_scheduled").map((r) => r.id)).toEqual(["w-1"]);
  });

  it("does not send the peer-voting push or auto-settle a TBD run", async () => {
    seedRun({});
    const body = await (await checkVoting()).json();
    expect(body).toMatchObject({ sent: false, settled: false });
    expect(h.pushes).toEqual([]);
    expect(h.settled).toEqual([]);
    expect(run().voting_notif_sent).toBe(false);
  });

  it("reminds, sends the voting push and settles once a real time is set", async () => {
    seedRun({});
    await ensureUpcomingSessionRateReminders(db());
    await checkVoting();
    setRealTime("2026-10-10T16:45:00.000Z");

    expect((await ensureUpcomingSessionRateReminders(db())).scheduled).toBe(1);
    expect(rateReminders()).toMatchObject([{ user_id: PLAYER, send_at: "2026-10-10T17:15:00.000Z" }]);

    const body = await (await checkVoting()).json();
    expect(body).toMatchObject({ sent: true, settled: true });
    expect(h.pushes).toHaveLength(1);
    expect(h.settled).toEqual(["ts-1"]);
  });

  it("moves an unsent reminder when the run's time changes", async () => {
    seedRun({ time_tbd: false, start_at: "2026-10-10T18:00:00.000Z" });
    await ensureUpcomingSessionRateReminders(db());
    expect(rateReminders()[0].send_at).toBe("2026-10-10T18:30:00.000Z");
    setRealTime("2026-10-10T20:00:00.000Z");
    await ensureUpcomingSessionRateReminders(db());
    expect(rateReminders()).toHaveLength(1);
    expect(rateReminders()[0].send_at).toBe("2026-10-10T20:30:00.000Z");
  });

  it("treats the run as not TBD when the time_tbd column is missing", async () => {
    h.db.missingColumns.pickup_runs = ["time_tbd"];
    seedRun({});
    delete run().time_tbd;
    expect((await ensureUpcomingSessionRateReminders(db())).scheduled).toBe(1);
    const body = await (await checkVoting()).json();
    expect(body).toMatchObject({ sent: true, settled: true });
  });
});
