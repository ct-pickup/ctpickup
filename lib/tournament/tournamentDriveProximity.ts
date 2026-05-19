import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDriveMinutesCache,
  filterProfilesByMaxDriveTime,
  type DriveMinutesCache,
  type ProfileDriveProximityRow,
} from "@/lib/pickup/profileMaxDriveFilter";

/** Fixed max drive time for all tournament invite and broadcast notifications. */
export const TOURNAMENT_MAX_DRIVE_MINUTES = 90;

export type TournamentLocationForProximity = {
  venue?: string | null;
  serviceRegion?: string | null;
};

function profilesWithTournamentDriveCap<T extends ProfileDriveProximityRow>(profiles: T[]): T[] {
  return profiles.map((p) => ({ ...p, max_drive_minutes: TOURNAMENT_MAX_DRIVE_MINUTES }));
}

/**
 * Keep profiles within 90 minutes of the tournament venue (Google Distance Matrix).
 * Falls back to `nearest_venue` service-region match when ZIP is missing or the API fails.
 */
export async function filterProfilesByTournamentDriveTime<T extends ProfileDriveProximityRow>(
  profiles: T[],
  tournament: TournamentLocationForProximity,
  cache?: DriveMinutesCache,
): Promise<T[]> {
  return filterProfilesByMaxDriveTime(
    profilesWithTournamentDriveCap(profiles),
    {
      locationPrivate: null,
      serviceRegion: tournament.serviceRegion ?? null,
      venue: tournament.venue ?? null,
    },
    cache,
  );
}

/** Whether one player is within tournament drive range (or region fallback). */
export async function profileWithinTournamentDriveTime(
  profile: ProfileDriveProximityRow,
  tournament: TournamentLocationForProximity,
  cache?: DriveMinutesCache,
): Promise<boolean> {
  const kept = await filterProfilesByTournamentDriveTime([profile], tournament, cache);
  return kept.length > 0;
}

/** Approved profile ids within 90 minutes of a tournament venue. */
export async function approvedUserIdsWithinTournamentDrive(
  admin: SupabaseClient,
  tournament: TournamentLocationForProximity,
  cache?: DriveMinutesCache,
): Promise<string[]> {
  const profRes = await admin
    .from("profiles")
    .select("id,nearest_venue,zip_code,max_drive_minutes")
    .eq("approved", true);
  if (profRes.error || !(profRes.data?.length ?? 0)) return [];

  const within = await filterProfilesByTournamentDriveTime(profRes.data ?? [], tournament, cache);
  return within.map((p) => p.id);
}

export { createDriveMinutesCache, type DriveMinutesCache };
