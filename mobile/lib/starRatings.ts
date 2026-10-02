import type { SupabaseClient } from "@supabase/supabase-js";

export type PlayerCard = { star: number; provisional: boolean; percentile: number | null };

/**
 * Player stars come only from `player_cards` (half-star steps, provisional flag, Top X% percentile).
 * Until those columns ship, the query fails and every caller hides stars.
 * Never derive stars from tier or score.
 */
export async function fetchPlayerCards(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, PlayerCard>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const cards = new Map<string, PlayerCard>();
  if (ids.length === 0) return cards;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("player_cards")
      .select("user_id,star_rating,star_provisional,percentile")
      .in("user_id", ids.slice(i, i + CHUNK));
    if (error) {
      console.warn("[stars] player_cards stars unavailable:", error.message);
      return new Map();
    }
    for (const row of (data ?? []) as Array<{
      user_id: string | null;
      star_rating: number | string | null;
      star_provisional: boolean | null;
      percentile: number | string | null;
    }>) {
      const star = row.star_rating == null ? NaN : Number(row.star_rating);
      if (!row.user_id || !Number.isFinite(star)) continue;
      const pct = row.percentile == null ? NaN : Number(row.percentile);
      cards.set(row.user_id, {
        star,
        provisional: row.star_provisional === true,
        percentile: Number.isFinite(pct) ? Math.min(100, Math.max(1, Math.round(pct))) : null,
      });
    }
  }
  return cards;
}

export async function fetchPlayerCard(supabase: SupabaseClient, userId: string): Promise<PlayerCard | null> {
  return (await fetchPlayerCards(supabase, [userId])).get(userId) ?? null;
}

export async function fetchPlayerStars(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const cards = await fetchPlayerCards(supabase, userIds);
  return new Map(Array.from(cards, ([id, card]) => [id, card.star]));
}

export function formatTopPercent(percentile: number | null | undefined): string | null {
  return percentile != null && Number.isFinite(percentile) ? `Top ${Math.max(1, Math.round(percentile))}%` : null;
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

/** Planned `pickup_runs.min_star`. Missing column means every run reads as open level. */
export async function fetchRunMinStars(
  supabase: SupabaseClient,
  runIds: string[],
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  const minStars = new Map<string, number>();
  if (ids.length === 0) return minStars;
  const { data, error } = await supabase.from("pickup_runs").select("id,min_star").in("id", ids);
  if (error) {
    console.warn("[stars] pickup_runs.min_star unavailable:", error.message);
    return minStars;
  }
  for (const row of (data ?? []) as Array<{ id: string; min_star: number | string | null }>) {
    const n = row.min_star == null ? NaN : Number(row.min_star);
    if (Number.isFinite(n)) minStars.set(row.id, n);
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
