import type { SupabaseClient } from "@supabase/supabase-js";
import { outcomeForTeam, type StoredResult } from "@/lib/pickup/resultOutcome";
import { POINTS, currentSeason, pointsReasonsForGame, seasonForStartAt, type PointsReason } from "@/lib/pickup/points";
import { isMissingTableError, loadExistingResult } from "@/lib/results/resultStore";

/**
 * points_events: one row per (user, run, reason), written by the server with the service role.
 * Every write for a run goes through public.points_replace_run, which deletes and reinserts that run's rows
 * in one transaction, so a retry or an edit always leaves exactly the rows the current result implies.
 */

export type PointsEventRow = {
  user_id: string;
  run_id: string;
  reason: PointsReason;
  points: number;
  season: string;
};

export type PointsTotals = { season_points: number; all_time_points: number };

type DbError = { message?: string; code?: string } | null | undefined;

/** True before 20261003000000_points_events.sql runs (table or RPC missing). */
export function isMissingLedgerError(err: DbError): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (
    isMissingTableError(err) ||
    err.code === "PGRST202" ||
    err.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(msg)
  );
}

/**
 * Pure: the ledger rows one run's result implies. Same rules as the record helper:
 *   played  a team assignment (A, B or C) and a posted result; this is the record's games count
 *   win     that team won (by score when both scores are set, else winning_team)
 *   draw    equal scores, or no winning team
 *   potd    the result's player_of_day, whether or not they were on a team (the record's POTD count)
 * The season is the kickoff's season in Eastern time; a run without start_at uses the result's posted time.
 */
export function pointsEventsForRun(args: {
  runId: string;
  startAt: string | null | undefined;
  postedAt?: string | null;
  result: (StoredResult & { player_of_day?: string | null }) | null;
  assignments: Array<{ user_id: string; team: string | null }>;
  now?: number;
}): PointsEventRow[] {
  const { runId, result } = args;
  if (!result) return [];
  const season = seasonForStartAt(args.startAt) ?? seasonForStartAt(args.postedAt) ?? currentSeason(args.now);
  const teams = new Map<string, string | null>();
  for (const a of args.assignments) if (a.user_id) teams.set(a.user_id, a.team);
  const potdId = result.player_of_day ?? null;
  const users = new Set<string>([...teams.keys(), ...(potdId ? [potdId] : [])]);

  const rows: PointsEventRow[] = [];
  for (const userId of users) {
    const outcome = outcomeForTeam(teams.get(userId) ?? null, result);
    for (const reason of pointsReasonsForGame(outcome, userId === potdId)) {
      rows.push({ user_id: userId, run_id: runId, reason, points: POINTS[reason], season });
    }
  }
  return rows;
}

/**
 * Recompute one run's ledger rows from its current result and team assignments. Call after a result is posted
 * or edited, teams change, or player_of_day is resolved. Never throws: a missing ledger (migration not run)
 * or a failed write is logged and the caller carries on; the backfill rebuilds from results.
 */
export async function syncRunPoints(
  admin: SupabaseClient,
  runId: string,
): Promise<{ ok: boolean; rows: number; missing?: boolean }> {
  try {
    const [existing, runRes, assignRes] = await Promise.all([
      loadExistingResult(admin, runId),
      admin.from("pickup_runs").select("start_at").eq("id", runId).maybeSingle(),
      admin.from("pickup_run_team_assignments").select("user_id,team").eq("run_id", runId),
    ]);
    if (existing.error) throw new Error(existing.error);
    if (runRes.error) throw new Error(runRes.error.message);
    if (assignRes.error) throw new Error(assignRes.error.message);

    const rows = pointsEventsForRun({
      runId,
      startAt: (runRes.data as { start_at?: string | null } | null)?.start_at ?? null,
      postedAt: existing.result?.created_at ?? null,
      result: existing.result,
      assignments: (assignRes.data ?? []) as Array<{ user_id: string; team: string | null }>,
    });
    const { error } = await admin.rpc("points_replace_run", {
      p_run_id: runId,
      p_rows: rows.map(({ user_id, reason, points, season }) => ({ user_id, reason, points, season })),
    });
    if (error) {
      if (isMissingLedgerError(error)) {
        console.warn("[points] ledger not migrated yet; skipped run", runId);
        return { ok: false, rows: 0, missing: true };
      }
      throw new Error(error.message);
    }
    return { ok: true, rows: rows.length };
  } catch (e) {
    console.error("[points] sync failed for run", runId, e instanceof Error ? e.message : String(e));
    return { ok: false, rows: 0 };
  }
}

const PAGE = 1000;
const CHUNK = 200;

/** Pure: season and all-time totals per user from ledger rows. */
export function totalsFromEvents(
  rows: Array<{ user_id: string; points: number; season: string }>,
  season: string,
): Map<string, PointsTotals> {
  const out = new Map<string, PointsTotals>();
  for (const r of rows) {
    let t = out.get(r.user_id);
    if (!t) out.set(r.user_id, (t = { season_points: 0, all_time_points: 0 }));
    const p = Number(r.points) || 0;
    t.all_time_points += p;
    if (r.season === season) t.season_points += p;
  }
  return out;
}

/**
 * Ledger totals for the given users, or for everyone when `userIds` is omitted.
 * Returns null when the ledger table does not exist yet, so callers fall back to computing from results.
 */
export async function loadPointsTotals(
  admin: SupabaseClient,
  season: string,
  userIds?: string[],
): Promise<Map<string, PointsTotals> | null> {
  const rows: Array<{ user_id: string; points: number; season: string }> = [];
  const read = async (ids: string[] | null): Promise<boolean> => {
    for (let from = 0; ; from += PAGE) {
      let q = admin.from("points_events").select("user_id,points,season");
      if (ids) q = q.in("user_id", ids);
      const { data, error } = await q.order("user_id").order("run_id").order("reason").range(from, from + PAGE - 1);
      if (error) {
        if (isMissingLedgerError(error)) return false;
        throw new Error(error.message);
      }
      const page = (data ?? []) as typeof rows;
      rows.push(...page);
      if (page.length < PAGE) return true;
    }
  };

  if (!userIds) {
    if (!(await read(null))) return null;
  } else {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    for (let i = 0; i < ids.length; i += CHUNK) {
      if (!(await read(ids.slice(i, i + CHUNK)))) return null;
    }
  }
  return totalsFromEvents(rows, season);
}
