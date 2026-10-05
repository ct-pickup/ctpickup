/**
 * Hub presets for the games finder. Edit this list to add or change a hub: `radiusMiles` is both how far the list
 * reaches from the center and how wide the map opens. "Nearby" (the player's own location) is always shown first
 * and is not listed here.
 */
export type FinderHub = {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  radiusMiles: number;
};

export const FINDER_HUBS: readonly FinderHub[] = [
  { id: "bucknell", name: "Bucknell / Lewisburg, PA", subtitle: "Central Pennsylvania", lat: 40.9645, lng: -76.8844, radiusMiles: 30 },
  { id: "fairfield", name: "Fairfield County, CT", subtitle: "Stamford to Bridgeport", lat: 41.2, lng: -73.3, radiusMiles: 25 },
  { id: "nyc-nj", name: "New York City / New Jersey", subtitle: "Five boroughs and North Jersey", lat: 40.73, lng: -74.0, radiusMiles: 35 },
];

export function finderHubById(id: string | null | undefined): FinderHub | null {
  return FINDER_HUBS.find((h) => h.id === id) ?? null;
}
