import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";
import {
  earliestExpiring,
  isRatingPending,
  JOINED_RSVP_STATUSES,
  pendingRatingFor,
  RATING_EXPIRES_AFTER_MS,
  ratingRequiredBody,
  type PendingFacts,
  type PendingRating,
} from "@/shared/ratingGate";

/**
 * The one place "pending rating" is worked out on the server (the rule itself is in shared/ratingGate.ts). Used by:
 *   - the routes that join, RSVP, book or create a game (ratingGateResponse, a 409 "Rate your last game first")
 *   - GET /api/sessions/pending-rating (the cards on Home and the Games tab)
 *   - the one reminder, 24 hours after kickoff (lib/ratings/ratingReminders.ts)
 *
 * It is behind the app_flags switch 'require_ratings'. Unlike the other flags, admins are exempt, not always on: an admin never
 * has a pending rating. Every error means "nothing is pending": this is a soft gate, and a database hiccup must not lock anyone out.
 */

export const REQUIRE_RATINGS_FLAG = "require_ratings";

type FlagRow = { enabled?: boolean | null; allowlist?: string[] | null } | null | undefined;

/** The rule, as a pure function: the flag is on for everyone or the player is listed, and the player is not an admin. */
export function ratingGateActive(row: FlagRow, userId: string | null | undefined, isAdmin: boolean): boolean {
  if (!userId || isAdmin || !row) return false;
  return row.enabled === true || (Array.isArray(row.allowlist) && row.allowlist.includes(userId));
}

export async function readRatingFlag(admin: SupabaseClient): Promise<FlagRow> {
  try {
    const { data, error } = await admin.from("app_flags").select("enabled,allowlist").eq("key", REQUIRE_RATINGS_FLAG).maybeSingle();
    return error ? null : (data as FlagRow);
  } catch {
    return null;
  }
}

/** Is the gate in force for this player? Reads the flag first, and the admin bit only when the flag could apply. */
export async function ratingGateActiveFor(admin: SupabaseClient, userId: string, opts: { isAdmin?: boolean } = {}): Promise<boolean> {
  if (opts.isAdmin === true) return false;
  const row = await readRatingFlag(admin);
  if (!ratingGateActive(row, userId, false)) return false;
  if (opts.isAdmin === false) return true;
  try {
    const { data } = await admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
    return (data as { is_admin?: boolean } | null)?.is_admin !== true;
  } catch {
    return true;
  }
}

type RunRow = { id: string; title: string | null; location_text: string | null; status: string | null; start_at: string | null; created_by: string | null; tier_session_id: string | null };

const CHUNK = 100;
const chunks = <T,>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

/** Plain name for a card: the game's title, else the first part of its address. */
function placeOf(r: Pick<RunRow, "title" | "location_text">): string | null {
  const t = r.title?.trim();
  if (t) return t;
  const first = (r.location_text ?? "").split(",")[0]?.trim();
  return first || null;
}

export type PendingForUser = { user_id: string; rating: PendingRating };

/**
 * Every pending rating, for one player (`userId`) or for everyone (reminders). Looks at games whose kickoff was in the last 72
 * hours and had at least `minAgeMs` ago, so it reads a few hundred rows at most.
 */
export async function loadPendingRatings(
  admin: SupabaseClient,
  opts: { userId?: string; now?: number; minAgeMs?: number } = {},
): Promise<PendingForUser[]> {
  const now = opts.now ?? Date.now();
  const lo = new Date(now - RATING_EXPIRES_AFTER_MS).toISOString();
  const hi = new Date(now - (opts.minAgeMs ?? 0)).toISOString();

  const runsRes = await admin
    .from("pickup_runs")
    .select("id,title,location_text,status,start_at,created_by,tier_session_id")
    .gte("start_at", lo)
    .lte("start_at", hi)
    .limit(1000);
  if (runsRes.error) return [];
  let runs = (runsRes.data ?? []) as RunRow[];
  if (!runs.length) return [];

  const tbd = await fetchRunTimeTbdIds(admin, runs.map((r) => r.id));
  runs = runs.filter((r) => !tbd.has(r.id) && r.created_by !== opts.userId);
  if (!runs.length) return [];

  // Which of these games did the player join? (Everyone, when reminding.)
  const joinedRows: { run_id: string; user_id: string; status: string }[] = [];
  for (const ids of chunks(runs.map((r) => r.id))) {
    let target = ids;
    if (opts.userId) {
      const mine = await admin.from("pickup_run_rsvps").select("run_id").in("run_id", ids).eq("user_id", opts.userId).in("status", [...JOINED_RSVP_STATUSES]);
      if (mine.error) return [];
      target = ((mine.data ?? []) as { run_id: string }[]).map((r) => r.run_id);
      if (!target.length) continue;
    }
    // Counting players needs the whole game, so read every joined row of the games in play.
    const { data, error } = await admin.from("pickup_run_rsvps").select("run_id,user_id,status").in("run_id", target).in("status", [...JOINED_RSVP_STATUSES]);
    if (error) return [];
    joinedRows.push(...((data ?? []) as typeof joinedRows));
  }
  const candidateIds = [...new Set(joinedRows.map((r) => r.run_id))];
  if (!candidateIds.length) return [];
  const candidates = runs.filter((r) => candidateIds.includes(r.id));

  const attendance = new Map<string, boolean>();
  for (const ids of chunks(candidateIds)) {
    const { data, error } = await admin.from("pickup_run_attendance").select("run_id,user_id,attended").in("run_id", ids);
    if (error) break; // the table or column is missing: nobody is marked
    for (const r of (data ?? []) as { run_id: string; user_id: string; attended: boolean | null }[]) {
      if (typeof r.attended === "boolean") attendance.set(`${r.run_id}|${r.user_id}`, r.attended);
    }
  }

  const sessionOf = new Map(candidates.filter((r) => r.tier_session_id).map((r) => [r.tier_session_id as string, r.id]));
  const ballots = new Set<string>();
  for (const ids of chunks([...sessionOf.keys()])) {
    let q = admin.from("peer_votes").select("session_id,voter_id").in("session_id", ids);
    if (opts.userId) q = q.eq("voter_id", opts.userId);
    const { data, error } = await q;
    if (error) return [];
    for (const v of (data ?? []) as { session_id: string; voter_id: string }[]) {
      const run = sessionOf.get(v.session_id);
      if (run) ballots.add(`${run}|${v.voter_id}`);
    }
  }

  const tournamentRuns = new Set<string>();
  for (const ids of chunks(candidateIds)) {
    const { data, error } = await admin.from("tournament_match_runs").select("run_id").in("run_id", ids);
    if (error) break; // not set up in this database: no game is a tournament match
    for (const r of (data ?? []) as { run_id: string }[]) tournamentRuns.add(r.run_id);
  }

  const countByRun = new Map<string, number>();
  for (const r of joinedRows) countByRun.set(r.run_id, (countByRun.get(r.run_id) ?? 0) + 1);

  const out: PendingForUser[] = [];
  for (const row of joinedRows) {
    if (opts.userId && row.user_id !== opts.userId) continue;
    const run = candidates.find((r) => r.id === row.run_id);
    if (!run) continue;
    const facts: PendingFacts = {
      run_id: run.id,
      status: run.status,
      start_at: run.start_at,
      time_tbd: false,
      host_id: run.created_by,
      joined_players: countByRun.get(run.id) ?? 0,
      my_status: row.status,
      attended: attendance.get(`${run.id}|${row.user_id}`) ?? null,
      has_ballot: ballots.has(`${run.id}|${row.user_id}`),
      in_tournament_match: tournamentRuns.has(run.id),
    };
    if (!isRatingPending(facts, row.user_id, now)) continue;
    const rating = pendingRatingFor(facts, placeOf(run));
    if (rating) out.push({ user_id: row.user_id, rating });
  }
  return out;
}

/** The pending rating that runs out first, or null. Never throws. */
export async function findPendingRating(admin: SupabaseClient, userId: string, now: number = Date.now()): Promise<PendingRating | null> {
  try {
    const list = await loadPendingRatings(admin, { userId, now });
    return earliestExpiring(list.map((p) => p.rating));
  } catch (e) {
    console.warn("[pendingRating] lookup failed; not blocking", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * For the routes that join, RSVP, book or create a game. Null when the player may continue; otherwise the 409
 * "Rate your last game first" with the pending game's id. Off, exempt (admins) and any error all mean null.
 */
export async function ratingGateResponse(
  admin: SupabaseClient,
  userId: string,
  opts: { isAdmin?: boolean; now?: number } = {},
): Promise<NextResponse | null> {
  try {
    if (!(await ratingGateActiveFor(admin, userId, { isAdmin: opts.isAdmin }))) return null;
    const pending = await findPendingRating(admin, userId, opts.now);
    return pending ? NextResponse.json(ratingRequiredBody(pending), { status: 409 }) : null;
  } catch {
    return null;
  }
}
