/** Turns the `tiers` rows of /api/leaderboards?scope=women into list rows. Pure. The server sends ranks, so rows are used as sent. */
export type WomenRow = {
  user_id: string;
  rank: number;
  games: number;
  points: number;
  name: string;
  username: string | null;
  avatar_url: string | null;
  nearest_venue: string | null;
  card: { star: number; provisional: boolean; percentile: number | null; exact: number | null; ratedGames: number | null } | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseWomenRows(raw: unknown): WomenRow[] {
  if (!Array.isArray(raw)) return [];
  const out: WomenRow[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.user_id !== "string") continue;
    const first = typeof item.first_name === "string" ? item.first_name : null;
    const last = typeof item.last_name === "string" ? item.last_name : null;
    const username = typeof item.username === "string" ? item.username : null;
    out.push({
      user_id: item.user_id,
      rank: finite(item.rank) ? item.rank : out.length + 1,
      games: finite(item.games) ? item.games : 0,
      points: finite(item.points) ? item.points : 0,
      name: [first, last].filter(Boolean).join(" ").trim() || username || "Player",
      username,
      avatar_url: typeof item.avatar_url === "string" ? item.avatar_url.trim() || null : null,
      nearest_venue: typeof item.nearest_venue === "string" ? item.nearest_venue : null,
      card: finite(item.star)
        ? {
            star: item.star,
            provisional: item.provisional === true,
            percentile: null,
            exact: finite(item.rating_exact) ? item.rating_exact : null,
            ratedGames: finite(item.rated_games) ? item.rated_games : null,
          }
        : null,
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}
