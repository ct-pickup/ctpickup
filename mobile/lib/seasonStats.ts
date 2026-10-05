import { seasonForStartAt } from "./pickup/points";

/** The part of a record game these helpers read (structurally the same as StatsGame in playerRecord.ts). */
export type StatsGame = {
  run_id: string;
  start_at: string | null;
  title: string | null;
  location_text: string | null;
  team: string | null;
  outcome: "W" | "D" | "L" | null;
  score: string | null;
  potd: boolean;
};

/** Games, wins, draws, losses and Player of the Day awards in one season, from the player's own game log. */
export type SeasonTotals = { games: number; wins: number; draws: number; losses: number; potd: number };

/** Only games with a posted result count, matching the points ledger's "played" rows. Season label like "Fall 2026". */
export function seasonTotals(log: readonly StatsGame[] | null | undefined, season: string): SeasonTotals {
  const t: SeasonTotals = { games: 0, wins: 0, draws: 0, losses: 0, potd: 0 };
  for (const g of log ?? []) {
    if (g.outcome == null || seasonForStartAt(g.start_at) !== season) continue;
    t.games += 1;
    if (g.outcome === "W") t.wins += 1;
    else if (g.outcome === "D") t.draws += 1;
    else t.losses += 1;
    if (g.potd) t.potd += 1;
  }
  return t;
}

/** The latest games that have a result, newest first. */
export function lastGames(log: readonly StatsGame[] | null | undefined, n: number): StatsGame[] {
  return (log ?? [])
    .filter((g) => g.outcome != null)
    .sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")))
    .slice(0, n);
}

/**
 * Shape of a rating over time, scaled to 0..1 so no rating numbers are ever shown (players see stars and level names,
 * never the underlying score). Needs at least two points; a flat series sits in the middle.
 */
export function trendShape(values: readonly number[]): number[] | null {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (max === min) return v.map(() => 0.5);
  return v.map((n) => (n - min) / (max - min));
}
