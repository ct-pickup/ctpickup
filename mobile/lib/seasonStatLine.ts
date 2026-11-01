import { seasonWindowFor } from "./pickup/seasonPrize";

/**
 * "Your season" header: the Player of the Day and Season pts stats, or one short line when they would only be zeros.
 * The season start comes from the shared season config (seasonWindowFor), never a hardcoded date.
 *   - the season has not started yet: "Season starts Sep 1"
 *   - started, but the player has no points this season: "No points yet this season (started Sep 1)"
 *   - otherwise (points above zero, or points unknown): show the stats.
 */
export type SeasonStatsView = { kind: "stats" } | { kind: "line"; text: string };

/** Eastern calendar day (YYYY-MM-DD) of a moment, to compare with the season's first day. */
function easternDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function seasonStatsView(points: number | null | undefined, now: number = Date.now(), seasonAt: number = now): SeasonStatsView {
  const season = seasonWindowFor(seasonAt);
  if (easternDay(now) < season.startDate) return { kind: "line", text: `Season starts ${season.startText}` };
  if (typeof points === "number" && points === 0) return { kind: "line", text: `No points yet this season (started ${season.startText})` };
  return { kind: "stats" };
}
