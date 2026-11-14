import { makeDb, type FakeDb } from "./fakeSupabase";

/** Saturday 2:00 PM Eastern. Every test in the require_ratings suite measures time from here. */
export const NOW = Date.parse("2026-11-14T19:00:00Z");
export const HOUR = 3_600_000;
export const iso = (ms: number) => new Date(ms).toISOString();

type Opts = {
  /** Kickoff of the one game, relative to NOW (milliseconds ago). Default 2 hours ago. */
  kickoffAgo?: number;
  status?: string;
  players?: number;
  flag?: { enabled?: boolean; allowlist?: string[] } | null;
  extra?: Record<string, Record<string, unknown>[]>;
};

/**
 * One game, "r1", hosted by "host1", with players p1..pN joined. "adm" is an admin and "p9" never joined.
 * The flag row starts OFF with p1 on the allowlist, like the plan: try it on one account first.
 */
export function ratingWorld(o: Opts = {}): FakeDb {
  const n = o.players ?? 4;
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const db = makeDb({
    profiles: [
      { id: "host1", approved: true, is_admin: false },
      { id: "adm", approved: true, is_admin: true },
      { id: "p9", approved: true, is_admin: false },
      ...players.map((id) => ({ id, approved: true, is_admin: false })),
    ],
    app_flags: o.flag === null ? [] : [{ key: "require_ratings", enabled: o.flag?.enabled ?? false, allowlist: o.flag?.allowlist ?? ["p1"] }],
    pickup_runs: [
      {
        id: "r1",
        title: "Sunday Pickup",
        location_text: "Field 3, Hartford",
        status: o.status ?? "active",
        start_at: iso(NOW - (o.kickoffAgo ?? 2 * HOUR)),
        created_by: "host1",
        tier_session_id: "ts1",
        time_tbd: false,
      },
    ],
    pickup_run_rsvps: players.map((id) => ({ run_id: "r1", user_id: id, status: "confirmed" })),
    peer_votes: [],
    pickup_run_attendance: [],
    tournament_match_runs: [],
    ...(o.extra ?? {}),
  });
  return db;
}
