import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Player stars come only from `player_cards.star_rating` (half-star steps).
 * Until that column ships, the query fails and every caller hides stars.
 * Never derive stars from tier or score.
 */
export async function fetchPlayerStars(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const stars = new Map<string, number>();
  if (ids.length === 0) return stars;
  const { data, error } = await supabase.from("player_cards").select("user_id,star_rating").in("user_id", ids);
  if (error) {
    console.warn("[stars] player_cards.star_rating unavailable:", error.message);
    return stars;
  }
  for (const row of (data ?? []) as Array<{ user_id: string | null; star_rating: number | string | null }>) {
    const n = row.star_rating == null ? NaN : Number(row.star_rating);
    if (row.user_id && Number.isFinite(n)) stars.set(row.user_id, n);
  }
  return stars;
}

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
