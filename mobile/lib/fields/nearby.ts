import type { MapRegion } from "./listings";
import { kindLabel } from "./listings";
import type { FieldFilters, FieldListing, Venue } from "./types";

/** What the app sends to the venues_nearby() database function, and how it reads the answer. Pure: no network. */

export type NearbyArgs = {
  /** The visible map area. Ignored while a text search is active (a search looks everywhere). */
  region: MapRegion | null;
  /** The player's position when known: results are sorted from here. Otherwise from the middle of the map. */
  user: { lat: number; lon: number } | null;
  filters: FieldFilters;
  limit: number;
  offset: number;
};

export type NearbyParams = Record<string, number | boolean | string | null>;

export function regionBounds(r: MapRegion) {
  return {
    minLat: r.latitude - r.latitudeDelta / 2,
    maxLat: r.latitude + r.latitudeDelta / 2,
    minLon: r.longitude - r.longitudeDelta / 2,
    maxLon: r.longitude + r.longitudeDelta / 2,
  };
}

/** Parameters for venues_nearby(): the area (box, or none for a search), the sort origin, the chips and the text. */
export function nearbyParams(a: NearbyArgs): NearbyParams {
  const q = a.filters.query.trim();
  const searching = q.length > 0;
  const box = !searching && a.region ? regionBounds(a.region) : null;
  const origin = a.user ?? (searching && a.region ? { lat: a.region.latitude, lon: a.region.longitude } : null);
  return {
    p_min_lat: box?.minLat ?? null,
    p_max_lat: box?.maxLat ?? null,
    p_min_lon: box?.minLon ?? null,
    p_max_lon: box?.maxLon ?? null,
    p_center_lat: origin?.lat ?? null,
    p_center_lon: origin?.lon ?? null,
    p_radius_miles: null,
    p_free: a.filters.free,
    p_turf: a.filters.turf,
    p_no_permit: a.filters.noPermit,
    p_lights: a.filters.lights,
    p_indoor: a.filters.indoor,
    p_query: searching ? q : null,
    p_limit: a.limit,
    p_offset: a.offset,
  };
}

/** A stable key for "the same request", so a pan that barely moves the map does not refetch. */
export function nearbyKey(a: Omit<NearbyArgs, "limit" | "offset">): string {
  const r = a.region;
  const q = a.filters.query.trim().toLowerCase();
  const reg = !q && r ? [r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta].map((n) => n.toFixed(3)).join(",") : "-";
  const u = a.user ? `${a.user.lat.toFixed(2)},${a.user.lon.toFixed(2)}` : "-";
  const f = a.filters;
  return [reg, u, f.free ? "F" : "", f.turf ? "T" : "", f.noPermit ? "N" : "", f.lights ? "L" : "", f.indoor ? "I" : "", q].join("|");
}

export type NearbyRow = { venue: Venue; distance_mi: number | null; total_count: number | string | null };

/**
 * Listings from the function's rows. Distance is shown only when it is measured from the player (otherwise it would be
 * from an arbitrary map center, which is misleading), and a venue is calendar-connected only if its key is in `connected`.
 */
export function rowsToListings(rows: NearbyRow[], opts: { connected: Set<string>; fromUser: boolean }): { items: FieldListing[]; total: number } {
  const items = rows.map((r) => ({
    venue: r.venue,
    kind_label: kindLabel(r.venue),
    distance_mi: opts.fromUser && r.distance_mi != null ? Number(r.distance_mi) : null,
    calendar_connected: opts.connected.has(r.venue.venue_key),
  }));
  const total = rows.length > 0 ? Number(rows[0]!.total_count ?? rows.length) : 0;
  return { items, total };
}

/** "1 field near you", "1,284 fields near you", or "12 fields match" while searching. */
export function countLabel(total: number, searching: boolean): string {
  const noun = total === 1 ? "field" : "fields";
  return `${total.toLocaleString("en-US")} ${noun} ${searching ? (total === 1 ? "matches" : "match") : "near you"}`;
}
