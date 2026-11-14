import type { SeasonStanding } from "./seasonCardCore";
import { standingRankText, standingStarsText } from "./seasonCardCore";

/** A run the Home screen already loaded (nearby or region). */
export type SuggestibleRun = { id: string; start_at: string; status: string | null };

/**
 * Up to `max` upcoming games to show under Today when nothing is booked: future kickoffs only, no cancelled or finished runs,
 * one entry per run, soonest first. Pure, so the rule is tested.
 */
export function upcomingSuggestions<T extends SuggestibleRun>(runs: ReadonlyArray<T>, now: number, max = 3): T[] {
  const seen = new Set<string>();
  return runs
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      const st = (r.status ?? "").toLowerCase();
      if (st === "canceled" || st === "cancelled" || st === "completed") return false;
      const t = Date.parse(r.start_at);
      return Number.isFinite(t) && t > now;
    })
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, max);
}

export type HomeSeasonModel = {
  /** "3.58" with the stars; null hides the stars row. */
  starsText: string | null;
  star: number | null;
  exact: number | null;
  provisional: boolean;
  /** "#22 of 270"; null hides the rank. */
  rankText: string | null;
  /** Games toward the prize; null hides the prize row and bar. */
  games: number | null;
  prizeEnabled: boolean;
};

/**
 * What the Home season card shows. Null hides the whole card: nothing loaded at all. Each piece hides on its own when it has no data.
 */
export function homeSeasonModel(standing: SeasonStanding | null, games: number | null, prizeEnabled: boolean): HomeSeasonModel | null {
  const hasRating = standing?.star != null;
  const showGames = prizeEnabled && games != null;
  if (!hasRating && !showGames) return null;
  return {
    starsText: hasRating ? standingStarsText(standing) : null,
    star: standing?.star ?? null,
    exact: standing?.exact ?? null,
    provisional: standing?.provisional === true,
    rankText: hasRating && standing?.rank != null ? standingRankText(standing) : null,
    games: showGames ? games : null,
    prizeEnabled,
  };
}
