import type { SupabaseClient } from "@supabase/supabase-js";
import { syncRunPoints } from "@/lib/points/ledger";
import { isScoredMatch, ratedChangeAllowed, type MatchRatingOutcome, type RatingReason, type RatingStatus } from "@/shared/ratedTournament";

/**
 * The server side of rated tournaments. The rating itself runs in the database (tournament_sync_match calls the existing
 * apply_result_rating); this file decides WHEN to call it and writes season points only when the tournament counts for the season.
 *
 * Rules kept here:
 *   - A tournament that is neither rated nor counted for the season is never touched: no query beyond reading its two flags.
 *   - Nothing here returns a rating. The outcome is counted yes or no and a reason code.
 *   - Nothing here sends a push.
 *   - Every failure is contained: a rating problem never fails the admin's score save.
 */

export type RatingOptions = { rated: boolean; count_for_season: boolean; scored_matches: number; slug: string | null };

const missing = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "42703" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|could not find/i.test(e.message ?? ""));

/** The two switches and how many matches have a score. A database that has no such columns reads as both off. */
export async function loadRatingOptions(admin: SupabaseClient, tournamentId: string): Promise<RatingOptions> {
  const t = await admin.from("tournaments").select("rated,count_for_season,slug").eq("id", tournamentId).maybeSingle();
  const row = (t.error ? null : t.data) as { rated?: boolean | null; count_for_season?: boolean | null; slug?: string | null } | null;
  const m = await admin.from("tournament_matches").select("completed_at,is_bye").eq("tournament_id", tournamentId);
  const scored = ((m.error ? [] : m.data) ?? []) as { completed_at?: string | null; is_bye?: boolean | null }[];
  return {
    rated: row?.rated === true,
    count_for_season: row?.count_for_season === true,
    scored_matches: scored.filter(isScoredMatch).length,
    slug: row?.slug ?? null,
  };
}

/** Run ids of the hidden game records of some matches. */
async function runIdsOf(admin: SupabaseClient, matchIds: string[]): Promise<string[]> {
  if (!matchIds.length) return [];
  const { data, error } = await admin.from("tournament_match_runs").select("run_id").in("match_id", matchIds);
  if (error) return [];
  return ((data ?? []) as { run_id: string }[]).map((r) => r.run_id);
}

async function matchIdsOf(admin: SupabaseClient, tournamentId: string): Promise<string[]> {
  const { data, error } = await admin.from("tournament_matches").select("id").eq("tournament_id", tournamentId);
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((r) => String(r.id));
}

/**
 * Season points follow count_for_season: written for a match's hidden record when the tournament counts, and cleared when it does not.
 * The 10 game prize counts the same ledger rows, so this is the one place a tournament can reach either.
 */
export async function syncSeasonPoints(admin: SupabaseClient, runIds: string[], countForSeason: boolean): Promise<void> {
  for (const runId of runIds) {
    if (countForSeason) {
      await syncRunPoints(admin, runId);
    } else {
      const { error } = await admin.rpc("points_replace_run", { p_run_id: runId, p_rows: [] });
      if (error && !missing(error)) console.error("[tournament] clearing season points failed", runId, error.message);
    }
  }
}

function asOutcome(raw: unknown): MatchRatingOutcome {
  const o = (raw ?? {}) as { status?: unknown; counted?: unknown; reason?: unknown };
  return {
    status: (typeof o.status === "string" ? o.status : "error") as RatingStatus,
    counted: o.counted === true,
    reason: typeof o.reason === "string" ? (o.reason as RatingReason) : null,
  };
}

/**
 * After a score is saved: create, update or remove the match's hidden record and rate it. Does nothing at all for a tournament that is
 * not rated and does not count for the season. Never throws.
 */
export async function rateScoredMatch(
  admin: SupabaseClient,
  input: { tournamentId: string; matchId: string; actorId: string },
): Promise<MatchRatingOutcome> {
  try {
    const opts = await loadRatingOptions(admin, input.tournamentId);
    if (!opts.rated && !opts.count_for_season) return { status: "off", counted: false, reason: null };

    const { data, error } = await admin.rpc("tournament_sync_match", { p_match_id: input.matchId, p_actor: input.actorId });
    if (error) {
      if (missing(error)) return { status: "unavailable", counted: false, reason: null };
      console.error("[tournament] rating sync failed", input.matchId, error.message);
      return { status: "error", counted: false, reason: null };
    }
    const outcome = asOutcome(data);

    const runs = await runIdsOf(admin, [input.matchId]);
    await syncSeasonPoints(admin, runs, opts.count_for_season);
    return outcome;
  } catch (e) {
    console.error("[tournament] rating sync crashed", e instanceof Error ? e.message : String(e));
    return { status: "error", counted: false, reason: null };
  }
}

/**
 * Before matches are removed or reset (a changed bracket, Generate again): take their rating effect back out and remove their
 * hidden records. Must run BEFORE the delete, because deleting a match drops the link to its record. Never throws.
 */
export async function forgetMatchRecords(admin: SupabaseClient, tournamentId: string, matchIds: string[]): Promise<void> {
  if (!matchIds.length) return;
  try {
    const opts = await loadRatingOptions(admin, tournamentId);
    if (!opts.rated && !opts.count_for_season) return;
    const { error } = await admin.rpc("tournament_forget_matches", { p_match_ids: matchIds });
    if (error && !missing(error)) console.error("[tournament] forgetting match records failed", error.message);
  } catch (e) {
    console.error("[tournament] forgetting match records crashed", e instanceof Error ? e.message : String(e));
  }
}

export type SetOptionsOutcome =
  | { ok: true; rated: boolean; count_for_season: boolean; rated_locked: boolean }
  | { ok: false; status: number; code: string; error: string };

/**
 * An admin changes Rated or Counts for season. Rated can only change while no match has a score. Counts for season can change at any
 * time: the matches that already have a score are brought in line (season points written, or cleared).
 */
export async function setRatingOptions(
  admin: SupabaseClient,
  input: { tournamentId: string; rated?: unknown; count_for_season?: unknown; actorId: string },
): Promise<SetOptionsOutcome> {
  const cur = await loadRatingOptions(admin, input.tournamentId);
  const t = await admin.from("tournaments").select("id").eq("id", input.tournamentId).maybeSingle();
  if (t.error || !t.data) return { ok: false, status: 404, code: "not_found", error: "Tournament not found" };

  const wantRated = typeof input.rated === "boolean" ? input.rated : cur.rated;
  const wantSeason = typeof input.count_for_season === "boolean" ? input.count_for_season : cur.count_for_season;
  if (input.rated !== undefined && typeof input.rated !== "boolean") return { ok: false, status: 400, code: "bad_value", error: "rated must be true or false" };
  if (input.count_for_season !== undefined && typeof input.count_for_season !== "boolean") {
    return { ok: false, status: 400, code: "bad_value", error: "count_for_season must be true or false" };
  }

  if (wantRated !== cur.rated && !ratedChangeAllowed(cur.scored_matches)) {
    return {
      ok: false,
      status: 409,
      code: "rated_locked",
      error: "Rated can’t be changed after the first match has a score. Changing it halfway through an event would leave some matches counted and others not.",
    };
  }
  if (wantRated === cur.rated && wantSeason === cur.count_for_season) {
    return { ok: true, rated: cur.rated, count_for_season: cur.count_for_season, rated_locked: !ratedChangeAllowed(cur.scored_matches) };
  }

  const up = await admin.from("tournaments").update({ rated: wantRated, count_for_season: wantSeason }).eq("id", input.tournamentId);
  if (up.error) {
    if (missing(up.error)) return { ok: false, status: 503, code: "unavailable", error: "Rated tournaments aren’t set up in this database yet." };
    return { ok: false, status: 500, code: "save_failed", error: up.error.message };
  }

  // Matches that already have a score follow the new season setting.
  if (wantSeason !== cur.count_for_season && cur.scored_matches > 0) {
    try {
      const { error } = await admin.rpc("tournament_sync_tournament", { p_tournament_id: input.tournamentId, p_actor: input.actorId });
      if (error && !missing(error)) console.error("[tournament] re-syncing matches failed", error.message);
      const runs = await runIdsOf(admin, await matchIdsOf(admin, input.tournamentId));
      await syncSeasonPoints(admin, runs, wantSeason);
    } catch (e) {
      console.error("[tournament] re-syncing matches crashed", e instanceof Error ? e.message : String(e));
    }
  }
  return { ok: true, rated: wantRated, count_for_season: wantSeason, rated_locked: !ratedChangeAllowed(cur.scored_matches) };
}

/** For the admin bracket screen: whether each scored match counted, and why not. Codes only. */
export async function loadMatchRatings(admin: SupabaseClient, tournamentId: string): Promise<Record<string, { counted: boolean; reason: string | null }>> {
  const ids = await matchIdsOf(admin, tournamentId);
  if (!ids.length) return {};
  const { data, error } = await admin.from("tournament_match_rating").select("match_id,counted,reason").in("match_id", ids);
  if (error) return {};
  const out: Record<string, { counted: boolean; reason: string | null }> = {};
  for (const r of (data ?? []) as { match_id: string; counted: boolean; reason: string | null }[]) {
    out[String(r.match_id)] = { counted: r.counted === true, reason: r.reason ?? null };
  }
  return out;
}
