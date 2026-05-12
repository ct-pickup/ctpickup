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

export async function userMayViewOutdoorTournamentBracket(
  admin: SupabaseClient,
  userId: string,
  tournamentId: string,
): Promise<boolean> {
  const { data: t } = await admin.from("tournaments").select("id,service_region").eq("id", tournamentId).maybeSingle();
  if (!t) return false;

  const { data: asCaptain } = await admin
    .from("tournament_captains")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (asCaptain) return true;

  const { data: asRoster } = await admin
    .from("tournament_roster")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .in("status", ["invited", "accepted"])
    .limit(1)
    .maybeSingle();
  if (asRoster) return true;

  const svc = t.service_region != null ? String(t.service_region).trim().toUpperCase() : "";
  if (!svc) return true;

  const { data: prof } = await admin.from("profiles").select("nearest_venue").eq("id", userId).maybeSingle();
  const nv = prof?.nearest_venue != null ? String(prof.nearest_venue).trim() : "";
  if (!nv) return true;
  const mapped = serviceRegionForVenueName(nv);
  if (!mapped) return true;
  return mapped === svc;
}
