/** Maps venue display names (same as `profiles.nearest_venue`) to pickup hub region codes. Keep in sync with `lib/pickup/venueServiceRegion.ts`. */

const VENUE_TO_SERVICE_REGION: Record<string, string> = {
  "Sofive Meadowlands": "NJ",
  "Sofive Cherry Hill": "NJ",
  "Sofive Brooklyn": "NY",
  "Hudson Sports Complex": "NY",
  "Hudson Sports": "NY",
  "New Rochelle SoccerRoof": "NY",
  "Sofive Rockville": "MD",
  "SoccerDome Jessup": "MD",
  "SoccerDome Harmans": "MD",
  "New Haven SoccerRoof": "CT",
};

export function serviceRegionForVenueName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const key = String(name).trim();
  if (!key) return null;
  return VENUE_TO_SERVICE_REGION[key] ?? null;
}
