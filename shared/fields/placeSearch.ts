import { metersBetween } from "./suggestions";

/** Map zoom (degrees of latitude shown) when the pin should sit on a field: about 330 m top to bottom. */
export const FIELD_DELTA = 0.003;
/** Below this zoom the Suggest a field map switches to satellite by itself (until the player picks a view). */
export const SATELLITE_BELOW_DELTA = 0.012;
/** A screen opened from a wider map than this centres on the player instead, if their location is known. */
export const WIDE_VIEW_DELTA = 0.02;
export const MAX_SUGGESTIONS = 5;
export const MIN_QUERY = 3;

export type PlaceHit = {
  key: string;
  label: string;
  sub: string | null;
  lat: number;
  lon: number;
  source: "venue" | "place";
};

export type MapKind = "standard" | "hybrid";

/** Satellite (with labels) once zoomed in, a plain map when zoomed out. A player's own choice always wins. */
export function mapKindFor(latitudeDelta: number, chosen: MapKind | null): MapKind {
  if (chosen) return chosen;
  return latitudeDelta < SATELLITE_BELOW_DELTA ? "hybrid" : "standard";
}

export function fieldRegion(lat: number, lon: number, delta: number = FIELD_DELTA) {
  return { latitude: lat, longitude: lon, latitudeDelta: delta, longitudeDelta: delta };
}

/** Makes typed text safe inside a PostgREST ilike filter (no wildcards or filter syntax of its own). */
export function ilikeTerm(q: string): string {
  return q
    .trim()
    .replace(/[%_*\\,()."']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Our own fields first (a school the geocoder does not know), then geocoder places. Places within 40 m of a venue already listed
 * are dropped, and the total is capped.
 */
export function mergeHits(venues: PlaceHit[], places: PlaceHit[], max: number = MAX_SUGGESTIONS): PlaceHit[] {
  const out: PlaceHit[] = venues.slice(0, 3);
  for (const p of places) {
    if (out.length >= max) break;
    if (out.some((o) => metersBetween(o.lat, o.lon, p.lat, p.lon) < 40)) continue;
    out.push(p);
  }
  return out.slice(0, max);
}

type Addr = { street?: string | null; name?: string | null; city?: string | null; subregion?: string | null; region?: string | null };

/** "Main St, Fairfield" for a pin: the nearest street, then the town. Null when the geocoder knows nothing. */
export function addressLine(a: Addr | null | undefined): string | null {
  if (!a) return null;
  const street = (a.street ?? "").trim() || ((a.name ?? "").trim() && !/^\d+$/.test((a.name ?? "").trim()) ? (a.name ?? "").trim() : "");
  const town = (a.city ?? "").trim() || (a.subregion ?? "").trim();
  const line = [street, town].filter(Boolean).join(", ");
  if (line) return a.region && town ? `${line}, ${a.region}` : line;
  return (a.region ?? "").trim() || null;
}
