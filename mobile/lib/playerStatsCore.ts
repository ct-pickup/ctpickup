/**
 * Profile game stats (view player_card_stats): record, average partner and opponent as stars, performance against expectation.
 * Pure helpers, no network. Raw ratings never reach the app; the view returns half stars and counts only.
 */
export type CardStats = {
  wins: number;
  draws: number;
  losses: number;
  partnerStars: number | null;
  opponentStars: number | null;
  partnerGames: number;
  opponentGames: number;
  perfGames: number;
  perfVsExpected: number | null;
  minGames: number;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A row from the view, or null when it is not usable. */
export function parseCardStats(row: unknown): CardStats | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const wins = num(r.wins), draws = num(r.draws), losses = num(r.losses);
  if (wins == null || draws == null || losses == null) return null;
  return {
    wins, draws, losses,
    partnerStars: num(r.partner_stars),
    opponentStars: num(r.opponent_stars),
    partnerGames: num(r.partner_games) ?? 0,
    opponentGames: num(r.opponent_games) ?? 0,
    perfGames: num(r.perf_games) ?? 0,
    perfVsExpected: num(r.perf_vs_expected),
    minGames: num(r.min_games) ?? 3,
  };
}

/** "3-1-2" (wins, draws, losses). */
export const recordLabel = (s: Pick<CardStats, "wins" | "draws" | "losses">): string => `${s.wins}-${s.draws}-${s.losses}`;
export const gamesInRecord = (s: Pick<CardStats, "wins" | "draws" | "losses">): number => s.wins + s.draws + s.losses;

/** Stars for an average, or null when there are too few games behind it. */
export function averageStars(stars: number | null, games: number, minGames: number): number | null {
  return stars != null && games >= minGames ? stars : null;
}

export type Performance = { label: string; detail: string | null; tone: "above" | "below" | "even" | "none" };

/** Above, below or about as expected, from the sum of (actual - expected) over the recent verified games. */
export function performance(s: Pick<CardStats, "perfGames" | "perfVsExpected" | "minGames">): Performance {
  const v = s.perfVsExpected;
  if (v == null || s.perfGames < s.minGames) return { label: "Not enough confirmed games yet", detail: null, tone: "none" };
  const detail = `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(1)} wins over ${s.perfGames} confirmed games`;
  if (v >= 0.5) return { label: "Above expected", detail, tone: "above" };
  if (v <= -0.5) return { label: "Below expected", detail, tone: "below" };
  return { label: "About as expected", detail, tone: "even" };
}
