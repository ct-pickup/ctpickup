import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";

const HUB = new Set(["NY", "CT", "NJ", "MD"]);

/**
 * Region code used for outdoor tournament hub resolution (query param wins when valid).
 */
export async function resolveOutdoorHubRegionForUser(
  admin: SupabaseClient,
  userId: string | null,
  queryRegion: string | null,
): Promise<string | null> {
  const q = queryRegion && HUB.has(queryRegion.trim().toUpperCase()) ? queryRegion.trim().toUpperCase() : null;
  if (q) return q;

  if (!userId) return null;

  const { data: prof } = await admin.from("profiles").select("nearest_venue").eq("id", userId).maybeSingle();
  const nv = prof?.nearest_venue != null ? String(prof.nearest_venue).trim() : "";
  if (!nv) return null;
  const mapped = serviceRegionForVenueName(nv);
  return mapped && HUB.has(mapped) ? mapped : null;
}

/** Any approved player (or admin) may view any outdoor tournament bracket; region is not gated. */
export async function userMayViewOutdoorTournamentBracket(
  admin: SupabaseClient,
  userId: string,
  tournamentId: string,
): Promise<boolean> {
  const { data: t } = await admin.from("tournaments").select("id").eq("id", tournamentId).maybeSingle();
  if (!t) return false;

  const { data: prof } = await admin.from("profiles").select("approved,is_admin").eq("id", userId).maybeSingle();
  return prof?.approved === true || prof?.is_admin === true;
}
