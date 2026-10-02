/**
 * Leaderboard points per rated session, keyed by player_ratings.tier.
 * tier maps 1:1 with the undamped star band, so points match what players
 * earned before stars. Server only: tier and these values never reach clients.
 */
const POINTS_PER_SESSION: Record<string, number> = {
  diamond: 8,
  platinum: 6,
  gold: 4,
  silver: 2,
  bronze: 0,
};

export function ratingPoints(tier: string | null | undefined, sessions: number | null | undefined): number {
  const perSession = POINTS_PER_SESSION[(tier ?? "").toLowerCase()] ?? 0;
  const n = Number(sessions ?? 0);
  return (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0) * perSession * 10;
}
