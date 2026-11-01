import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Optional gender filter for the leaderboards (All / Male / Female), like DUPR's.
 *
 *   - Only the exact values "male" and "female" filter. "all" (or anything else) is the normal, unfiltered list.
 *   - The filter reads profiles.gender with the service role (this module is only called from the API route) and keeps players whose
 *     gender is EXACTLY that value. Players whose gender is "other", "prefer_not_to_say" or blank appear only under All.
 *   - The gender value is used here and then dropped: it is never added to a row and never returned in a response.
 *   - Every category is built from the one filtered profile list, so ranks restart at 1 inside the filtered list.
 */
export type GenderFilter = "all" | "male" | "female";

export function parseGenderFilter(raw: string | null | undefined): GenderFilter {
  return raw === "male" || raw === "female" ? raw : "all";
}

const PAGE = 1000;

/** Ids of the players whose profiles.gender is exactly `gender`. A read error means nobody matches (an empty list, never a leak). */
export async function loadGenderIds(admin: SupabaseClient, gender: "male" | "female"): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("gender", gender)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return new Set();
    const rows = (data ?? []) as Array<{ id: string }>;
    for (const r of rows) ids.add(r.id);
    if (rows.length < PAGE) return ids;
  }
}

/** The profile list for a filter: everyone for "all", otherwise only the matching players. */
export async function applyGenderFilter<T extends { id: string }>(
  admin: SupabaseClient,
  profiles: readonly T[],
  gender: GenderFilter,
): Promise<T[]> {
  if (gender === "all") return [...profiles];
  const ids = await loadGenderIds(admin, gender);
  return profiles.filter((p) => ids.has(p.id));
}
