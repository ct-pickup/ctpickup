import type { SupabaseClient } from "@supabase/supabase-js";
import { outcomeForTeam, scoreLineForTeam, type PlayerOutcome } from "@/lib/pickup/resultOutcome";
import { currentSeason, pointsForGame, seasonForStartAt } from "@/lib/pickup/points";
import { loadPointsTotals, type PointsTotals } from "@/lib/points/ledger";
import { isMissingColumnError } from "@/lib/results/resultStore";

/**
 * The one source for a player's pickup record. Everything is recomputed from
 * pickup_run_results and pickup_run_team_assignments; the stored counters
 * (profiles.pickup_wins_count/pickup_losses_count, player_ratings.sessions) are never read here.
 *
 * A game counts toward the record when a result is posted and the player was on a team.
 * Draws count as games played; win % is wins / games.
 *
 * Points come from the points_events ledger (see lib/points/ledger.ts). Until that table exists they are
 * computed here from the same games with the same rules (lib/pickup/points.ts), so the numbers match.
 */

export type RecordGame = {
  run_id: string;
  start_at: string | null;
  title: string | null;
  location_text: string | null;
  team: string | null;
  outcome: PlayerOutcome | null;
  /** "5–3" from the player's side, or null when the score was not tracked. */
  score: string | null;
  potd: boolean;
};

export type PlayerRecordSummary = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** wins / games (0–1), null before the first game. */
  win_pct: number | null;
  potd_count: number;
  /** Current season label in Eastern time, e.g. "Fall 2026" or "Winter 2026–27". */
  season: string;
  season_points: number;
  all_time_points: number;
};

export type PlayerRecord = PlayerRecordSummary & {
  /** Last five decided games, oldest first. */
  form: PlayerOutcome[];
  /** Newest first. Includes past games without a result (no outcome) so the log matches the Games tab. */
  log: RecordGame[];
};

export type RecordRun = { id: string; start_at: string | null; title: string | null; location_text: string | null; status: string | null };
export type RecordResult = {
  run_id: string;
  winning_team: string | null;
  score_a?: number | null;
  score_b?: number | null;
  player_of_day?: string | null;
};

export type RecordInputs = {
  /** This player's team per run. */
  teams: Map<string, string>;
  results: Map<string, RecordResult>;
  runs: Map<string, RecordRun>;
  /** Runs the player was confirmed for (shown in the log even before a result is posted). */
  confirmedRunIds: Iterable<string>;
};

const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
const FORM_LENGTH = 5;

function isCanceled(status: string | null | undefined): boolean {
  const st = (status ?? "").trim().toLowerCase();
  return st === "canceled" || st === "cancelled";
}

function isPastRun(run: RecordRun | undefined, now: number): boolean {
  if (!run || isCanceled(run.status)) return false;
  if ((run.status ?? "").trim().toLowerCase() === "completed") return true;
  const t = run.start_at ? Date.parse(run.start_at) : NaN;
  return Number.isFinite(t) && t < now - LIVE_WINDOW_MS;
}

/** Pure: points from the log with the ledger's rules. Games without a known kickoff count toward all time only. */
export function pointsFromLog(log: RecordGame[], season: string): PointsTotals {
  let seasonPoints = 0;
  let allTime = 0;
  for (const g of log) {
    const p = pointsForGame(g.outcome, g.potd);
    allTime += p;
    if (seasonForStartAt(g.start_at) === season) seasonPoints += p;
  }
  return { season_points: seasonPoints, all_time_points: allTime };
}

export function summarizeLog(log: RecordGame[], season: string = currentSeason()): PlayerRecordSummary {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let potd = 0;
  for (const g of log) {
    if (g.outcome === "W") wins += 1;
    else if (g.outcome === "D") draws += 1;
    else if (g.outcome === "L") losses += 1;
    if (g.potd) potd += 1;
  }
  const games = wins + draws + losses;
  return {
    games,
    wins,
    draws,
    losses,
    win_pct: games > 0 ? wins / games : null,
    potd_count: potd,
    season,
    ...pointsFromLog(log, season),
  };
}

/** Ledger totals replace the computed points; a player with no ledger rows has 0. */
export function withLedgerPoints<T extends PlayerRecordSummary>(summary: T, totals: Map<string, PointsTotals>, userId: string): T {
  const t = totals.get(userId);
  return { ...summary, season_points: t?.season_points ?? 0, all_time_points: t?.all_time_points ?? 0 };
}

export function formFromLog(log: RecordGame[], n = FORM_LENGTH): PlayerOutcome[] {
  return log
    .filter((g): g is RecordGame & { outcome: PlayerOutcome } => g.outcome != null)
    .sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")))
    .slice(0, n)
    .reverse()
    .map((g) => g.outcome);
}

/** Pure: the record, form strip and match log for one player from already-loaded rows. */
export function buildPlayerRecord(userId: string, inputs: RecordInputs, now = Date.now()): PlayerRecord {
  const season = currentSeason(now);
  const ids = new Set<string>([...inputs.teams.keys(), ...inputs.confirmedRunIds]);
  for (const r of inputs.results.values()) if (r.player_of_day === userId) ids.add(r.run_id);

  const log: RecordGame[] = [];
  for (const runId of ids) {
    const run = inputs.runs.get(runId);
    const result = inputs.results.get(runId) ?? null;
    if (!result && !isPastRun(run, now)) continue;
    if (run && isCanceled(run.status) && !result) continue;
    const team = inputs.teams.get(runId) ?? null;
    log.push({
      run_id: runId,
      start_at: run?.start_at ?? null,
      title: run?.title ?? null,
      location_text: run?.location_text ?? null,
      team,
      outcome: outcomeForTeam(team, result),
      score: scoreLineForTeam(team, result),
      potd: result?.player_of_day === userId,
    });
  }
  log.sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")));
  return { ...summarizeLog(log, season), form: formFromLog(log), log };
}

/** Pure: summaries for many players from all assignments and results (same rules as buildPlayerRecord). */
export function buildRecordSummaries(
  assignments: Array<{ run_id: string; user_id: string; team: string }>,
  results: RecordResult[],
  userIds?: Iterable<string>,
  runs: Map<string, RecordRun> = new Map(),
  season: string = currentSeason(),
): Map<string, PlayerRecordSummary> {
  const resultByRun = new Map(results.map((r) => [r.run_id, r]));
  const teamsByUser = new Map<string, Map<string, string>>();
  for (const a of assignments) {
    if (!resultByRun.has(a.run_id)) continue;
    let m = teamsByUser.get(a.user_id);
    if (!m) teamsByUser.set(a.user_id, (m = new Map()));
    m.set(a.run_id, a.team);
  }
  const potdRunsByUser = new Map<string, Map<string, RecordResult>>();
  for (const r of results) {
    if (!r.player_of_day) continue;
    let m = potdRunsByUser.get(r.player_of_day);
    if (!m) potdRunsByUser.set(r.player_of_day, (m = new Map()));
    m.set(r.run_id, r);
  }

  const users = new Set<string>(userIds ?? [...teamsByUser.keys(), ...potdRunsByUser.keys()]);
  const out = new Map<string, PlayerRecordSummary>();
  for (const uid of users) {
    const teams = teamsByUser.get(uid) ?? new Map<string, string>();
    const own = new Map<string, RecordResult>(potdRunsByUser.get(uid) ?? []);
    for (const runId of teams.keys()) own.set(runId, resultByRun.get(runId)!);
    const record = buildPlayerRecord(uid, { teams, results: own, runs, confirmedRunIds: [] });
    out.set(uid, summarizeLog(record.log, season));
  }
  return out;
}

export const EMPTY_SUMMARY: Omit<PlayerRecordSummary, "season"> = {
  games: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  win_pct: null,
  potd_count: 0,
  season_points: 0,
  all_time_points: 0,
};

export function emptySummary(season: string = currentSeason()): PlayerRecordSummary {
  return { ...EMPTY_SUMMARY, season };
}

// ------------------------------------------------------------
// Loaders (service role). Separate queries merged in JS; no joins.
// ------------------------------------------------------------

const PAGE = 1000;
const CHUNK = 200;
const RESULT_COLUMNS = "run_id,winning_team,player_of_day";

type Admin = SupabaseClient;
type QueryResult = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

async function paginate<T>(build: (from: number, to: number) => QueryResult): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Results with scores when the scores migration has run, without them before. */
async function selectResults(
  build: (columns: string) => (from: number, to: number) => QueryResult,
): Promise<RecordResult[]> {
  try {
    return await paginate<RecordResult>(build(`${RESULT_COLUMNS},score_a,score_b`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isMissingColumnError({ message: msg })) throw e;
    return paginate<RecordResult>(build(RESULT_COLUMNS));
  }
}

async function resultsForRuns(admin: Admin, runIds: string[]): Promise<RecordResult[]> {
  const out: RecordResult[] = [];
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const chunk = runIds.slice(i, i + CHUNK);
    out.push(
      ...(await selectResults((cols) => (from, to) =>
        admin.from("pickup_run_results").select(cols).in("run_id", chunk).order("run_id").range(from, to),
      )),
    );
  }
  return out;
}

/** Full record for one player (header, form strip and match log). About 5 queries plus 2 per 200 games. */
export async function loadPlayerRecord(admin: Admin, userId: string, now = Date.now()): Promise<PlayerRecord> {
  const [assignments, rsvps, potdRuns] = await Promise.all([
    paginate<{ run_id: string; team: string }>((from, to) =>
      admin.from("pickup_run_team_assignments").select("run_id,team").eq("user_id", userId).order("run_id").range(from, to),
    ),
    paginate<{ run_id: string | null }>((from, to) =>
      admin
        .from("pickup_run_rsvps")
        .select("run_id")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .order("run_id")
        .range(from, to),
    ),
    paginate<{ run_id: string }>((from, to) =>
      admin.from("pickup_run_results").select("run_id").eq("player_of_day", userId).order("run_id").range(from, to),
    ),
  ]);

  const teams = new Map(assignments.map((a) => [a.run_id, a.team]));
  const confirmedRunIds = rsvps.map((r) => r.run_id).filter((v): v is string => Boolean(v));
  const runIds = Array.from(new Set([...teams.keys(), ...confirmedRunIds, ...potdRuns.map((r) => r.run_id)]));

  const runs = await runsById(admin, runIds);
  const results = new Map((await resultsForRuns(admin, runIds)).map((r) => [r.run_id, r]));
  const record = buildPlayerRecord(userId, { teams, results, runs, confirmedRunIds }, now);
  const totals = await ledgerTotals(admin, record.season, [userId]);
  return totals ? withLedgerPoints(record, totals, userId) : record;
}

/** Ledger totals, or null to keep the computed points (ledger not migrated, or a read failed). */
async function ledgerTotals(admin: Admin, season: string, userIds?: string[]): Promise<Map<string, PointsTotals> | null> {
  try {
    const totals = await loadPointsTotals(admin, season, userIds);
    if (!totals) console.warn("[records] points_events missing; points computed from results");
    return totals;
  } catch (e) {
    console.error("[records] points_events read failed; points computed from results:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function runsById(admin: Admin, runIds: string[]): Promise<Map<string, RecordRun>> {
  const runs = new Map<string, RecordRun>();
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("pickup_runs")
      .select("id,start_at,title,location_text,status")
      .in("id", runIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as RecordRun[]) runs.set(r.id, r);
  }
  return runs;
}

/**
 * Season and all-time points: ledger totals when the table exists; otherwise computed from the same results,
 * which needs each run's kickoff for the season.
 */
async function attachPoints(
  admin: Admin,
  build: (runs: Map<string, RecordRun>, season: string) => Map<string, PlayerRecordSummary>,
  runIds: string[],
  userIds?: string[],
): Promise<Map<string, PlayerRecordSummary>> {
  const season = currentSeason();
  const totals = await ledgerTotals(admin, season, userIds);
  if (!totals) return build(await runsById(admin, runIds), season);
  const out = build(new Map(), season);
  for (const [uid, s] of out) out.set(uid, withLedgerPoints(s, totals, uid));
  if (!userIds) {
    for (const uid of totals.keys()) if (!out.has(uid)) out.set(uid, withLedgerPoints(emptySummary(season), totals, uid));
  }
  return out;
}

/**
 * Summaries for the given players, or every player with a posted game when `userIds` is omitted.
 * The all-players mode scans results and assignments once: about (results + assignments) / 1000 queries.
 */
export async function loadRecordSummaries(admin: Admin, userIds?: string[]): Promise<Map<string, PlayerRecordSummary>> {
  if (!userIds) {
    const results = await selectResults((cols) => (from, to) =>
      admin.from("pickup_run_results").select(cols).order("run_id").range(from, to),
    );
    const assignments = await paginate<{ run_id: string; user_id: string; team: string }>((from, to) =>
      admin.from("pickup_run_team_assignments").select("run_id,user_id,team").order("run_id").order("user_id").range(from, to),
    );
    return attachPoints(
      admin,
      (runs, season) => buildRecordSummaries(assignments, results, undefined, runs, season),
      results.map((r) => r.run_id),
    );
  }

  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const assignments: Array<{ run_id: string; user_id: string; team: string }> = [];
  const potdRunIds: string[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    assignments.push(
      ...(await paginate<{ run_id: string; user_id: string; team: string }>((from, to) =>
        admin
          .from("pickup_run_team_assignments")
          .select("run_id,user_id,team")
          .in("user_id", chunk)
          .order("run_id")
          .order("user_id")
          .range(from, to),
      )),
    );
    potdRunIds.push(
      ...(
        await paginate<{ run_id: string }>((from, to) =>
          admin.from("pickup_run_results").select("run_id").in("player_of_day", chunk).order("run_id").range(from, to),
        )
      ).map((r) => r.run_id),
    );
  }
  const runIds = Array.from(new Set([...assignments.map((a) => a.run_id), ...potdRunIds]));
  const results = await resultsForRuns(admin, runIds);
  return attachPoints(admin, (runs, season) => buildRecordSummaries(assignments, results, ids, runs, season), runIds, ids);
}

export function summaryFor(map: Map<string, PlayerRecordSummary>, userId: string): PlayerRecordSummary {
  return map.get(userId) ?? emptySummary();
}
