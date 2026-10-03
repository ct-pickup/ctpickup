import { siteOrigin } from "@/lib/env";
import { seasonForStartAt } from "@/lib/pickup/points";
import { seasonWindowFor } from "@/lib/pickup/seasonPrize";
import type { RecordGame } from "@/lib/playerRecord";

/** The viewer's place in this season's points ranking, from the /api/leaderboards own row. */
export type SeasonStanding = {
  /** Season points; 0 when the viewer has none yet. */
  points: number;
  /** True rank in the full season ranking, or null when the viewer has no season points yet (not on the board). */
  rank: number | null;
  /** Players on the season board. */
  total: number | null;
};

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

/** The viewer's own row out of a season points list (rows already carry their true rank) plus the season total. */
export function standingFromRows(rows: readonly unknown[], userId: string | null | undefined, total: number | null | undefined): SeasonStanding {
  const mine = userId
    ? (rows.find((r) => r != null && typeof r === "object" && (r as { id?: unknown }).id === userId) as { value?: unknown; rank?: unknown } | undefined)
    : undefined;
  const value = Number(mine?.value);
  return {
    points: mine && Number.isFinite(value) ? value : 0,
    rank: mine && typeof mine.rank === "number" ? mine.rank : null,
    total: typeof total === "number" ? total : null,
  };
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
    const j = (await r.json().catch(() => null)) as { points?: unknown; totals?: { points?: number } } | null;
    if (!j || !Array.isArray(j.points)) return null;
    return standingFromRows(j.points, userId, j.totals?.points);
  } catch {
    return null;
  }
}
