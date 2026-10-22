import { distanceMiles } from "../finderFilters";
import type { FieldListing, Venue } from "./types";

export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const KIND_LABELS: Record<string, string> = {
  school_public: "Public school",
  school_private: "Private school",
  school_unknown: "School",
  park: "Park",
  club: "Club",
  other: "Field",
};

export function kindLabel(v: Pick<Venue, "venue_type">): string {
  return KIND_LABELS[v.venue_type ?? ""] ?? "Field";
}

/** A venues row as the Fields list shows it. `connected` comes from connected_venue_keys(); `user` is optional. */
export function toListing(v: Venue, opts: { user?: { lat: number; lon: number } | null; connected?: boolean } = {}): FieldListing {
  const user = opts.user;
  const miles = user && v.lat != null && v.lon != null ? distanceMiles(user.lat, user.lon, v.lat, v.lon) : null;
  return { venue: v, kind_label: kindLabel(v), distance_mi: miles, calendar_connected: opts.connected === true };
}

/** Nearest first when distance is known, otherwise higher priority first, then by name. */
export function sortListings(list: FieldListing[]): FieldListing[] {
  return [...list].sort((a, b) => {
    const da = a.distance_mi;
    const db = b.distance_mi;
    if (da != null && db != null && da !== db) return da - db;
    if (da != null && db == null) return -1;
    if (da == null && db != null) return 1;
    const pa = a.venue.priority ?? 0;
    const pb = b.venue.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.venue.name.localeCompare(b.venue.name);
  });
}

/** Venues inside the visible map area (a little padded), at most `cap` of them, in the order given. Keeps the map light. */
export function pinsInRegion(list: FieldListing[], r: MapRegion, cap: number): FieldListing[] {
  const padLat = r.latitudeDelta * 0.1;
  const padLon = r.longitudeDelta * 0.1;
  const out: FieldListing[] = [];
  for (const f of list) {
    const { lat, lon } = f.venue;
    if (lat == null || lon == null) continue;
    if (Math.abs(lat - r.latitude) > r.latitudeDelta / 2 + padLat) continue;
    if (Math.abs(lon - r.longitude) > r.longitudeDelta / 2 + padLon) continue;
    out.push(f);
    if (out.length >= cap) break;
  }
  return out;
}
