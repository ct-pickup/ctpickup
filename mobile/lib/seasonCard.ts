import { siteOrigin } from "@/lib/env";
import { seasonForStartAt } from "@/lib/pickup/points";
import { seasonWindowFor } from "@/lib/pickup/seasonPrize";
import type { RecordGame } from "@/lib/playerRecord";
import { standingFromTiers, type SeasonStanding } from "@/lib/seasonCardCore";

export { standingFromTiers, standingRankText, standingStarsText, type SeasonStanding } from "@/lib/seasonCardCore";

function easternDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Days left in the current season, counting today (the last day reads "1 day left"). */
export function seasonDaysLeft(now: number = Date.now()): number {
  const end = Date.parse(`${seasonWindowFor(now).endDate}T00:00:00Z`);
  const today = Date.parse(`${easternDate(now)}T00:00:00Z`);
  return Math.max(0, Math.round((end - today) / 86_400_000) + 1);
}

/** Games with a posted result in the given season (same rule as the ledger's "played" row). Uses the existing record log. */
export function seasonGamesFromLog(log: readonly RecordGame[] | null | undefined, season: string = seasonWindowFor().label): number {
  if (!log) return 0;
  return log.filter((g) => g.outcome != null && seasonForStartAt(g.start_at) === season).length;
}

/** One /api/leaderboards call, used only where the leaderboard payload is not already in hand (Profile). */
export async function fetchSeasonStanding(accessToken: string | null, userId: string | null | undefined): Promise<SeasonStanding | null> {
  const origin = siteOrigin();
  if (!origin || !accessToken || !userId) return null;
  try {
    const r = await fetch(`${origin}/api/leaderboards`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { tiers?: unknown; totals?: { tiers?: number } } | null;
    if (!j || !Array.isArray(j.tiers)) return null;
    return standingFromTiers(j.tiers, userId, j.totals?.tiers);
  } catch {
    return null;
  }
}
