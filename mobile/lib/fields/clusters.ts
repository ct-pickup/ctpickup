import type { MapRegion } from "./listings";
import type { FieldListing } from "./types";

/** Below this zoom (degrees of latitude shown) pins are never merged: two fields at the same spot cannot be pulled apart. */
export const MIN_CLUSTER_DELTA = 0.006;
/** Two pins closer than this many screen points are merged into one numbered bubble. A price pin is about this wide. */
export const CLUSTER_MIN_DISTANCE_PX = 56;
export const NEAREST_COUNT = 15;
const USER_LAT_DELTA = 0.1;

export type MapSize = { width: number; height: number };

export type PinItem =
  | { kind: "pin"; key: string; listing: FieldListing; lat: number; lon: number }
  | { kind: "cluster"; key: string; count: number; members: FieldListing[]; lat: number; lon: number };

type Located = { f: FieldListing; lat: number; lon: number };

function located(list: FieldListing[]): Located[] {
  const out: Located[] = [];
  for (const f of list) if (f.venue.lat != null && f.venue.lon != null) out.push({ f, lat: f.venue.lat, lon: f.venue.lon });
  return out;
}

/** Smallest region holding every point, with padding and a floor so a single point still gets a sensible zoom. */
export function fitRegion(points: { lat: number; lon: number }[], padding = 1.35, minDelta = 0.04): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * padding, minDelta),
    longitudeDelta: Math.max((maxLon - minLon) * padding, minDelta * 1.4),
  };
}

/** Rough squared distance in degrees, longitude scaled by latitude. Only used to rank neighbors. */
function rank(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = a.lat - b.lat;
  const dLon = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

/**
 * Where the map opens. With the user's position: a neighborhood-sized view around them. Without it: the best-ranked venue
 * (the list is already sorted) and its nearest neighbors, so the map never opens on one blob of every venue.
 */
export function initialRegion(list: FieldListing[], user: { lat: number; lon: number } | null, count = NEAREST_COUNT): MapRegion | null {
  if (user) {
    return { latitude: user.lat, longitude: user.lon, latitudeDelta: USER_LAT_DELTA, longitudeDelta: USER_LAT_DELTA * 1.4 };
  }
  const pts = located(list);
  const anchor = pts[0];
  if (!anchor) return null;
  const nearest = [...pts].sort((a, b) => rank(anchor, a) - rank(anchor, b)).slice(0, count);
  return fitRegion(nearest);
}

function toPx(lat: number, lon: number, r: MapRegion, size: MapSize): { x: number; y: number } {
  return {
    x: ((lon - (r.longitude - r.longitudeDelta / 2)) / r.longitudeDelta) * size.width,
    y: (((r.latitude + r.latitudeDelta / 2) - lat) / r.latitudeDelta) * size.height,
  };
}

function inView(lat: number, lon: number, r: MapRegion): boolean {
  const padLat = r.latitudeDelta * 0.1;
  const padLon = r.longitudeDelta * 0.1;
  return Math.abs(lat - r.latitude) <= r.latitudeDelta / 2 + padLat && Math.abs(lon - r.longitude) <= r.longitudeDelta / 2 + padLon;
}

/**
 * What to draw for the current view: venues in view, merged wherever two would overlap on screen, capped at `cap` items.
 * Input order is kept (the list is best-first), so the cap drops the least relevant items, never a whole cluster's members.
 * At the closest zoom nothing is merged. Pure: positions are computed from the region and the map's size in points.
 */
export function clusterListings(
  list: FieldListing[],
  region: MapRegion,
  size: MapSize,
  opts: { cap?: number; minDistancePx?: number } = {},
): PinItem[] {
  const cap = opts.cap ?? 60;
  const minDist = opts.minDistancePx ?? CLUSTER_MIN_DISTANCE_PX;
  const visible = located(list).filter((p) => inView(p.lat, p.lon, region));
  const noMerge = region.latitudeDelta <= MIN_CLUSTER_DELTA;

  type Group = { members: Located[]; lat: number; lon: number; x: number; y: number };
  const groups: Group[] = [];
  for (const p of visible) {
    const px = toPx(p.lat, p.lon, region, size);
    let hit: Group | undefined;
    if (!noMerge) {
      for (const g of groups) {
        if (Math.hypot(g.x - px.x, g.y - px.y) < minDist) {
          hit = g;
          break;
        }
      }
    }
    if (hit) {
      hit.members.push(p);
      const n = hit.members.length;
      hit.lat = (hit.lat * (n - 1) + p.lat) / n;
      hit.lon = (hit.lon * (n - 1) + p.lon) / n;
      const c = toPx(hit.lat, hit.lon, region, size);
      hit.x = c.x;
      hit.y = c.y;
    } else {
      groups.push({ members: [p], lat: p.lat, lon: p.lon, x: px.x, y: px.y });
    }
  }

  const items: PinItem[] = groups.map((g) =>
    g.members.length === 1
      ? { kind: "pin", key: g.members[0]!.f.venue.venue_key, listing: g.members[0]!.f, lat: g.lat, lon: g.lon }
      : {
          kind: "cluster",
          key: `c:${g.members.map((m) => m.f.venue.venue_key).sort()[0]}:${g.members.length}`,
          count: g.members.length,
          members: g.members.map((m) => m.f),
          lat: g.lat,
          lon: g.lon,
        },
  );
  return items.slice(0, cap);
}

/** Where tapping a cluster zooms to: its members, filling the view, and always at least 3x closer than now so it splits. */
export function regionForCluster(members: FieldListing[], current: MapRegion): MapRegion {
  const pts = located(members);
  const fit = fitRegion(pts, 1.5, MIN_CLUSTER_DELTA);
  const maxDelta = current.latitudeDelta / 3;
  const base = fit ?? current;
  const latDelta = Math.max(MIN_CLUSTER_DELTA * 0.9, Math.min(base.latitudeDelta, maxDelta));
  return { latitude: base.latitude, longitude: base.longitude, latitudeDelta: latDelta, longitudeDelta: latDelta * (current.longitudeDelta / current.latitudeDelta) };
}

/** Bubble diameter in points for a cluster of `count` venues. */
export function clusterSize(count: number): number {
  return Math.min(56, 34 + Math.round(Math.log2(count) * 6));
}
