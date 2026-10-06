import type { SupabaseClient } from "@supabase/supabase-js";

import { seasonForStartAt } from "@/lib/pickup/points";
import { outcomeForTeam, scoreLineForTeam, type PlayerOutcome } from "@/lib/pickup/resultOutcome";
import { isMissingColumnError, isMissingTableError } from "@/lib/results/resultStore";

/**
 * The signed-in player's own detailed game log and insights (CT+). Everything here is the player's own data plus,
 * per game, the NAMES (first name and last initial) of the people who were on the same run: exactly what participants
 * of a run can already see in the app. No email, phone, Instagram, ZIP, ratings or scores of other people.
 *
 * Not available in the data, so not built: the position played in a game (only the profile's current position is
 * stored, not one per game), so there is no win rate by position.
 */

export type RatingDirection = "up" | "down" | "flat";

export type GameLogEntry = {
  run_id: string;
  start_at: string | null;
  season: string | null;
  venue: string | null;
  outcome: PlayerOutcome | null;
  /** "5–3" from the player's side, or null when the score was not tracked. */
  score: string | null;
  /** First name and last initial, from the player's team (never the player). */
  teammates: string[];
  awards: string[];
  /** Points earned for this game from the points ledger; null when the ledger is unavailable. */
  points: number | null;
  /** Direction of the rating after this game; null when no rating event exists for it. Never a number. */
  rating: RatingDirection | null;
};

export type TeammateRecord = { name: string; games: number; wins: number; draws: number; losses: number };

export type GameLogInsights = {
  currentWinStreak: number;
  longestWinStreak: number;
  teammates: TeammateRecord[];
  /** 0..1 shape of the rating over the last year (no numbers), with indexes where the season changes. */
  ratingTrend: { shape: number[]; seasonBreaks: number[] } | null;
};

export const GAME_LOG_PAGE_SIZE = 20;
export const GAME_LOG_MAX_OFFSET = 2000;
/** A teammate needs this many shared games to get a record card. */
export const MIN_TEAMMATE_GAMES = 3;
const TEAMMATE_CARD_LIMIT = 10;
const TREND_MAX_POINTS = 120;

/** Direction of a rating change. Anything within half a point either way is flat. */
export function ratingDirection(delta: number | null | undefined): RatingDirection | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  return delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat";
}

/** Current win streak (from the latest game back) and the longest win streak. Games newest first; a draw breaks a streak. */
export function winStreaks(outcomesNewestFirst: ReadonlyArray<PlayerOutcome | null>): { current: number; longest: number } {
  const played = outcomesNewestFirst.filter((o): o is PlayerOutcome => o != null);
  let current = 0;
  for (const o of played) {
    if (o !== "W") break;
    current += 1;
  }
  let longest = 0;
  let run = 0;
  for (const o of played) {
    run = o === "W" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return { current, longest };
}

export type TeammateGame = { outcome: PlayerOutcome | null; teammates: ReadonlyArray<{ id: string; name: string }> };

/** The player's record with each teammate they have shared a team with at least `min` times, most games first. */
export function teammateRecords(games: readonly TeammateGame[], min: number = MIN_TEAMMATE_GAMES): TeammateRecord[] {
  const by = new Map<string, TeammateRecord>();
  for (const g of games) {
    if (g.outcome == null) continue;
    for (const t of g.teammates) {
      const r = by.get(t.id) ?? { name: t.name, games: 0, wins: 0, draws: 0, losses: 0 };
      r.games += 1;
      if (g.outcome === "W") r.wins += 1;
      else if (g.outcome === "D") r.draws += 1;
      else r.losses += 1;
      by.set(t.id, r);
    }
  }
  return [...by.values()]
    .filter((r) => r.games >= min)
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, TEAMMATE_CARD_LIMIT);
}

/** Win rate for display, or null with no games. */
export function winRate(wins: number, games: number): number | null {
  return games > 0 ? wins / games : null;
}

/** Scales a series to 0..1 so no rating numbers leave the server; null under two points; a flat series sits at 0.5. */
export function shapeOf(values: readonly number[]): number[] | null {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  return max === min ? v.map(() => 0.5) : v.map((n) => (n - min) / (max - min));
}

/** Rating trend across seasons from rating events (oldest first): the shape, thinned to a sensible size, plus season breaks. */
export function ratingTrendOf(events: ReadonlyArray<{ score_after: number; created_at: string }>): GameLogInsights["ratingTrend"] {
  const ordered = [...events].filter((e) => Number.isFinite(e.score_after)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  let picked = ordered;
  if (ordered.length > TREND_MAX_POINTS) {
    const step = (ordered.length - 1) / (TREND_MAX_POINTS - 1);
    picked = Array.from({ length: TREND_MAX_POINTS }, (_, i) => ordered[Math.round(i * step)]!);
  }
  const shape = shapeOf(picked.map((e) => e.score_after));
  if (!shape) return null;
  const seasonBreaks: number[] = [];
  let prev: string | null = null;
  picked.forEach((e, i) => {
    const s = seasonForStartAt(e.created_at);
    if (i > 0 && s !== prev) seasonBreaks.push(i);
    prev = s;
  });
  return { shape, seasonBreaks };
}

export type GameLogPage = { games: GameLogEntry[]; nextCursor: string | null };

/** One page (newest first) of an already-built log. Pure. */
export function pageGameLog(all: readonly GameLogEntry[], offset: number, size: number = GAME_LOG_PAGE_SIZE): GameLogPage {
  const next = offset + size;
  return { games: all.slice(offset, next), nextCursor: next < all.length ? String(next) : null };
}

/** Reads the `cursor` query value: a whole offset within bounds, or an error. */
export function parseGameLogCursor(raw: string | null): { ok: true; offset: number } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, offset: 0 };
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= GAME_LOG_MAX_OFFSET ? { ok: true, offset: n } : { ok: false };
}

// ------------------------------------------------------------
// Loader (service role). Separate queries merged in JS, like lib/records/playerRecord.ts.
// ------------------------------------------------------------

const CHUNK = 200;
type Admin = SupabaseClient;

function shortName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "Player";
  if (!l) return f;
  if (!f) return `${l[0]!.toUpperCase()}.`;
  return `${f} ${l[0]!.toUpperCase()}.`;
}

type ResultRow = {
  run_id: string;
  winning_team: string | null;
  score_a?: number | null;
  score_b?: number | null;
  player_of_day?: string | null;
  goalie_of_the_day?: string | null;
  defender_of_day?: string | null;
  midfielder_of_day?: string | null;
  attacker_of_day?: string | null;
};

async function resultsFor(admin: Admin, runIds: string[]): Promise<Map<string, ResultRow>> {
  const out = new Map<string, ResultRow>();
  const column_sets = [
    "run_id,winning_team,score_a,score_b,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day",
    "run_id,winning_team,score_a,score_b,player_of_day",
    "run_id,winning_team,player_of_day",
  ];
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const chunk = runIds.slice(i, i + CHUNK);
    let done = false;
    for (const cols of column_sets) {
      const res = await admin.from("pickup_run_results").select(cols).in("run_id", chunk);
      if (res.error) {
        if (isMissingColumnError(res.error)) continue;
        throw new Error(res.error.message);
      }
      for (const row of (res.data ?? []) as unknown as ResultRow[]) out.set(row.run_id, row);
      done = true;
      break;
    }
    if (!done) throw new Error("Could not read results.");
  }
  return out;
}

export type GameLogData = { all: GameLogEntry[]; insights: GameLogInsights };

/** Builds the player's whole log and insights from their own rows. Callers page the result. */
export async function loadGameLog(admin: Admin, userId: string, now: number = Date.now()): Promise<GameLogData> {
  const mine = await admin.from("pickup_run_team_assignments").select("run_id,team").eq("user_id", userId).limit(5000);
  if (mine.error) throw new Error(mine.error.message);
  const myTeam = new Map(((mine.data ?? []) as Array<{ run_id: string; team: string }>).map((r) => [r.run_id, r.team]));
  const runIds = [...myTeam.keys()];
  if (!runIds.length) return { all: [], insights: { currentWinStreak: 0, longestWinStreak: 0, teammates: [], ratingTrend: null } };

  const results = await resultsFor(admin, runIds);
  const withResult = runIds.filter((id) => results.has(id));

  const runs = new Map<string, { id: string; title: string | null; location_text: string | null; start_at: string | null; tier_session_id?: string | null }>();
  for (let i = 0; i < withResult.length; i += CHUNK) {
    const chunk = withResult.slice(i, i + CHUNK);
    const full = await admin.from("pickup_runs").select("id,title,location_text,start_at,tier_session_id").in("id", chunk);
    const res = full.error && isMissingColumnError(full.error) ? await admin.from("pickup_runs").select("id,title,location_text,start_at").in("id", chunk) : full;
    if (res.error) throw new Error(res.error.message);
    for (const r of (res.data ?? []) as unknown as Array<{ id: string; title: string | null; location_text: string | null; start_at: string | null; tier_session_id?: string | null }>) runs.set(r.id, r);
  }

  // Everyone who was on the same run, then their names. Only names leave this function.
  const rosterByRun = new Map<string, Array<{ user_id: string; team: string }>>();
  for (let i = 0; i < withResult.length; i += CHUNK) {
    const res = await admin.from("pickup_run_team_assignments").select("run_id,user_id,team").in("run_id", withResult.slice(i, i + CHUNK));
    if (res.error) throw new Error(res.error.message);
    for (const r of (res.data ?? []) as Array<{ run_id: string; user_id: string; team: string }>) {
      const list = rosterByRun.get(r.run_id) ?? [];
      list.push(r);
      rosterByRun.set(r.run_id, list);
    }
  }
  const mateIds = new Set<string>();
  for (const [runId, roster] of rosterByRun) {
    const team = myTeam.get(runId);
    for (const p of roster) if (p.user_id !== userId && p.team === team) mateIds.add(p.user_id);
  }
  const names = new Map<string, string>();
  const ids = [...mateIds];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await admin.from("profiles").select("id,first_name,last_name").in("id", ids.slice(i, i + CHUNK));
    if (res.error) throw new Error(res.error.message);
    for (const p of (res.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) names.set(p.id, shortName(p.first_name, p.last_name));
  }

  // Points per game from the ledger; null per game when the ledger does not exist yet.
  const pointsByRun = new Map<string, number>();
  let ledgerOk = true;
  for (let i = 0; i < withResult.length; i += CHUNK) {
    const res = await admin.from("points_events").select("run_id,points").eq("user_id", userId).in("run_id", withResult.slice(i, i + CHUNK));
    if (res.error) {
      if (!isMissingTableError(res.error)) console.warn("[game-log] points ledger unavailable");
      ledgerOk = false;
      break;
    }
    for (const r of (res.data ?? []) as Array<{ run_id: string; points: number }>) pointsByRun.set(r.run_id, (pointsByRun.get(r.run_id) ?? 0) + (Number(r.points) || 0));
  }

  // Rating events (own rows), by tier session. Only the direction of each change is kept per game.
  const events = await admin
    .from("rating_events")
    .select("session_id,delta,score_after,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(2000);
  const evRows = events.error ? [] : ((events.data ?? []) as Array<{ session_id: string; delta: number | string; score_after: number | string; created_at: string }>);
  const deltaBySession = new Map(evRows.map((e) => [e.session_id, Number(e.delta)]));

  const entries: Array<GameLogEntry & { _mates: Array<{ id: string; name: string }> }> = withResult.map((runId) => {
    const run = runs.get(runId);
    const result = results.get(runId)!;
    const team = myTeam.get(runId) ?? null;
    const mates = (rosterByRun.get(runId) ?? []).filter((p) => p.user_id !== userId && p.team === team).map((p) => ({ id: p.user_id, name: names.get(p.user_id) ?? "Player" }));
    const awards: string[] = [];
    if (result.player_of_day === userId) awards.push("Player of the Day");
    if (result.goalie_of_the_day === userId) awards.push("Goalie of the Day");
    if (result.defender_of_day === userId) awards.push("Defender of the Day");
    if (result.midfielder_of_day === userId) awards.push("Midfielder of the Day");
    if (result.attacker_of_day === userId) awards.push("Attacker of the Day");
    const sessionId = run?.tier_session_id ?? null;
    return {
      run_id: runId,
      start_at: run?.start_at ?? null,
      season: seasonForStartAt(run?.start_at) ?? null,
      venue: (run?.location_text?.split(/\r?\n/)[0]?.trim() || run?.title) ?? null,
      outcome: outcomeForTeam(team, result),
      score: scoreLineForTeam(team, result),
      teammates: mates.map((m) => m.name),
      awards,
      points: ledgerOk ? (pointsByRun.get(runId) ?? 0) : null,
      rating: sessionId ? ratingDirection(deltaBySession.get(sessionId)) : null,
      _mates: mates,
    };
  });
  entries.sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")));

  const streak = winStreaks(entries.map((e) => e.outcome));
  const yearAgo = new Date(now - 365 * 86_400_000).toISOString();
  const insights: GameLogInsights = {
    currentWinStreak: streak.current,
    longestWinStreak: streak.longest,
    teammates: teammateRecords(entries.map((e) => ({ outcome: e.outcome, teammates: e._mates }))),
    ratingTrend: ratingTrendOf(evRows.filter((e) => e.created_at >= yearAgo).map((e) => ({ score_after: Number(e.score_after), created_at: e.created_at }))),
  };
  return { all: entries.map(({ _mates, ...rest }) => (void _mates, rest)), insights };
}
