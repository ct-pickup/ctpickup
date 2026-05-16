/** Maps venue display names (same as `profiles.nearest_venue`) to pickup hub region codes. Keep in sync with `lib/pickup/venueServiceRegion.ts`. */

const VENUE_TO_SERVICE_REGION: Record<string, string> = {
  "Sofive Meadowlands": "NJ",
  "Sofive Meadowlands 5v5": "NJ",
  "Sofive Meadowlands 7v7": "NJ",
  "Sofive Cherry Hill": "NJ",
  "Sofive Cherry Hill 5v5": "NJ",
  "Sofive Cherry Hill 7v7": "NJ",
  "Sofive Brooklyn": "NY",
  "Hudson Sports Complex": "NY",
  "Hudson Sports": "NY",
  "New Rochelle SoccerRoof": "NY",
  "New Rochelle": "NY",
  "Sofive Rockville": "MD",
  "Sofive Columbia": "MD",
  "SoccerDome Jessup": "MD",
  "SoccerDome Harmans": "MD",
  "Baltimore SoccerRoof": "MD",
  "DC SoccerRoof": "MD",
  "New Haven SoccerRoof": "CT",
};

export function serviceRegionForVenueName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const key = String(name).trim();
  if (!key) return null;
  return VENUE_TO_SERVICE_REGION[key] ?? null;
}
