import type { SupabaseClient } from "@supabase/supabase-js";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";


export type OutdoorTournamentRow = Record<string, unknown> & { id: string };

/**
 * Picks the live outdoor tournament for a hub region, matching `api/tournament/public`:
 * prefer `is_active` + `service_region` = region; else legacy `service_region` null.
 */
export async function selectActiveOutdoorTournamentForRegion(
  admin: SupabaseClient,
  regionCode: string | null,
): Promise<{
  data: OutdoorTournamentRow | null;
  error: { message: string } | null;
  matchStep?: "region" | "legacy_null_region" | "any_active" | "none";
}> {
  const region = regionCode && HUB_REGIONS.has(regionCode.toUpperCase()) ? regionCode.toUpperCase() : null;

  if (region) {
    const r1 = await admin.from("tournaments").select("*").eq("is_active", true).eq("service_region", region).maybeSingle();
    if (r1.error) return { data: null, error: r1.error, matchStep: "region" };
    if (r1.data) return { data: r1.data as OutdoorTournamentRow, error: null, matchStep: "region" };

    const r2 = await admin.from("tournaments").select("*").eq("is_active", true).is("service_region", null).maybeSingle();
    if (r2.error) return { data: null, error: r2.error, matchStep: "legacy_null_region" };
    if (r2.data) return { data: r2.data as OutdoorTournamentRow, error: null, matchStep: "legacy_null_region" };
    const rAny = await admin.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle();
    if (rAny.error) return { data: null, error: rAny.error, matchStep: "any_active" };
    return {
      data: (rAny.data as OutdoorTournamentRow | null) ?? null,
      error: null,
      matchStep: rAny.data ? "any_active" : "none",
    };
  }

  const r0 = await admin.from("tournaments").select("*").eq("is_active", true).is("service_region", null).maybeSingle();
  if (r0.error) return { data: null, error: r0.error, matchStep: "legacy_null_region" };
  if (r0.data) return { data: r0.data as OutdoorTournamentRow, error: null, matchStep: "legacy_null_region" };

  const rAny = await admin.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle();
  if (rAny.error) return { data: null, error: rAny.error, matchStep: "any_active" };
  return {
    data: (rAny.data as OutdoorTournamentRow | null) ?? null,
    error: null,
    matchStep: rAny.data ? "any_active" : "none",
  };
}
