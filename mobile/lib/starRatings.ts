import type { SupabaseClient } from "@supabase/supabase-js";

export type PlayerCard = {
  star: number;
  provisional: boolean;
  percentile: number | null;
  /** Exact two decimal rating, rated games and games to settle. Null until the player_cards migration is applied or when not asked for. */
  exact?: number | null;
  ratedGames?: number | null;
  settledGames?: number | null;
  /** Show-up reliability, 0 to 100 (player_cards.attendance_reliability). Null until its migration is applied or when not asked for. */
  attendanceReliability?: number | null;
};

/**
 * Player stars come only from `player_cards` (half-star steps, provisional flag, Top X% percentile).
 * Until those columns ship, the query fails and every caller hides stars.
 * Never derive stars from tier or score.
 * `withExact` also reads the exact rating and game counts (profiles only). If those columns do not exist yet, it falls back to the
 * star columns alone, so profiles keep today's display.
 */
export async function fetchPlayerCards(
  supabase: SupabaseClient,
  userIds: string[],
  options: { withExact?: boolean } = {},
): Promise<Map<string, PlayerCard>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const cards = new Map<string, PlayerCard>();
  if (ids.length === 0) return cards;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const base = "user_id,star_rating,star_provisional,percentile";
    const chunk = ids.slice(i, i + CHUNK);
    type Res = { data: unknown; error: { message: string } | null };
    const read = (cols: string) => supabase.from("player_cards").select(cols).in("user_id", chunk) as unknown as PromiseLike<Res>;
    // Newest columns first; each older shape is the fallback when a migration has not been applied yet.
    const exactCols = `${base},rating_exact,rated_games,settled_games`;
    let res = await read(options.withExact ? `${exactCols},attendance_reliability` : base);
    if (res.error && options.withExact) res = await read(exactCols);
    if (res.error && options.withExact) res = await read(base);
    const { data, error } = res;
    if (error) {
      console.warn("[stars] player_cards stars unavailable:", error.message);
      return new Map();
    }
    for (const row of (data ?? []) as Array<{
      user_id: string | null;
      star_rating: number | string | null;
      star_provisional: boolean | null;
      percentile: number | string | null;
      rating_exact?: number | string | null;
      rated_games?: number | string | null;
      settled_games?: number | string | null;
      attendance_reliability?: number | string | null;
    }>) {
      const star = row.star_rating == null ? NaN : Number(row.star_rating);
      if (!row.user_id || !Number.isFinite(star)) continue;
      const pct = row.percentile == null ? NaN : Number(row.percentile);
      cards.set(row.user_id, {
        star,
        provisional: row.star_provisional === true,
        percentile: Number.isFinite(pct) ? Math.min(100, Math.max(1, Math.round(pct))) : null,
        exact: numOrNull(row.rating_exact),
        ratedGames: numOrNull(row.rated_games),
        settledGames: numOrNull(row.settled_games),
        attendanceReliability: numOrNull(row.attendance_reliability),
      });
    }
  }
  return cards;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** One player's card with the exact rating and game counts, for profile screens. */
export async function fetchPlayerCard(supabase: SupabaseClient, userId: string): Promise<PlayerCard | null> {
  return (await fetchPlayerCards(supabase, [userId], { withExact: true })).get(userId) ?? null;
}

export async function fetchPlayerStars(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const cards = await fetchPlayerCards(supabase, userIds);
  return new Map(Array.from(cards, ([id, card]) => [id, card.star]));
}

/** "Top X%" only for non-provisional players in the top half; otherwise null so callers show stars alone. */
export function topPercentLabel(card: Pick<PlayerCard, "provisional" | "percentile"> | null | undefined): string | null {
  if (!card || card.provisional) return null;
  const pct = card.percentile;
  if (pct == null || !Number.isFinite(pct)) return null;
  const x = Math.max(1, Math.round(pct));
  return x <= 50 ? `Top ${x}%` : null;
}

/** Host ratings are stored 1..5; players see them out of 100. */
export function hostScore(avg: number | null | undefined): number | null {
  return avg != null && Number.isFinite(avg) ? Math.round((avg / 5) * 100) : null;
}

/**
 * Star range for each skill value the session APIs accept (`min_tier`, organizer scores).
 * The keys are API values only; never show them to players.
 */
export const SKILL_STAR_RANGE: Record<string, { low: number; high: number }> = {
  bronze: { low: 0.5, high: 1.0 },
  silver: { low: 1.5, high: 2.0 },
  gold: { low: 2.5, high: 3.0 },
  platinum: { low: 3.5, high: 4.0 },
  diamond: { low: 4.5, high: 5.0 },
};

/** Lowest star of each open_tier_rank band: rank 0 is open to everyone and has no entry. */
const TIER_RANK_STAR_LOW: Record<number, number> = { 1: 0.5, 2: 1.5, 3: 2.5, 4: 3.5, 5: 4.5 };

/** A game's minimum level in stars: `pickup_runs.min_star`, else its `open_tier_rank` band. Absent means open level. */
export async function fetchRunMinStars(
  supabase: SupabaseClient,
  runIds: string[],
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  const minStars = new Map<string, number>();
  if (ids.length === 0) return minStars;

  // min_star (any half star) wins. Games made before it, or before its migration, use their open_tier_rank band.
  const { data, error } = await supabase.from("pickup_runs").select("id,min_star,open_tier_rank").in("id", ids);
  let rows = data as Array<{ id: string; min_star?: number | string | null; open_tier_rank?: number | string | null }> | null;
  if (error) {
    const ranks = await supabase.from("pickup_runs").select("id,open_tier_rank").in("id", ids);
    rows = ranks.data as typeof rows;
  }
  for (const row of rows ?? []) {
    const exact = row.min_star == null ? NaN : Number(row.min_star);
    if (Number.isFinite(exact)) {
      minStars.set(row.id, exact);
      continue;
    }
    const low = TIER_RANK_STAR_LOW[Number(row.open_tier_rank)];
    if (low != null) minStars.set(row.id, low);
  }
  return minStars;
}

export function formatStars(value: number): string {
  return `${value.toFixed(1)} ★`;
}

/** Mean of the given stars rounded to the nearest half, or null when nobody has a star. */
export function averageStars(values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (known.length === 0) return null;
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  return Math.round(mean * 2) / 2;
}

export function levelLabel(minStar: number | null | undefined): string {
  return minStar != null && Number.isFinite(minStar) ? `${minStar.toFixed(1)}+ recommended` : "Open level";
}
