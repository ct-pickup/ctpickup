import type { SupabaseClient } from "@supabase/supabase-js";
import * as Location from "expo-location";

import { FIELDS_SAMPLE_DATA } from "./config";
import { toListing } from "./listings";
import { getSampleField } from "./sampleData";
import type { FieldListing, Venue } from "./types";

/** Listings seen so far, so a field page opened from the list or map needs no second fetch. */
const cache = new Map<string, FieldListing>();

export function rememberListings(list: FieldListing[]): void {
  for (const f of list) cache.set(f.venue.venue_key, f);
  // Keep the memory bounded while someone pans around the country.
  if (cache.size > 3000) {
    const drop = [...cache.keys()].slice(0, cache.size - 2000);
    drop.forEach((k) => cache.delete(k));
  }
}

/** Loaded listing for a key, or the sample venue when the dev flag is on. */
export function getCachedListing(key: string | null | undefined): FieldListing | null {
  if (!key) return null;
  return cache.get(key) ?? (FIELDS_SAMPLE_DATA ? getSampleField(key) : null);
}

let connectedAt = 0;
let connectedSet = new Set<string>();

/** Venues with a live calendar, cached for a minute. A failed lookup means nothing is connected: times then show Unknown, never Open. */
export async function connectedKeys(supabase: SupabaseClient): Promise<Set<string>> {
  if (Date.now() - connectedAt < 60_000) return connectedSet;
  const { data, error } = await supabase.rpc("connected_venue_keys");
  if (error || !Array.isArray(data)) return new Set();
  connectedSet = new Set((data as unknown[]).map((k) => (typeof k === "string" ? k : String((k as { connected_venue_keys?: string })?.connected_venue_keys ?? ""))));
  connectedAt = Date.now();
  return connectedSet;
}

/** Last known position only if location permission was already granted. Never prompts. */
export async function quietUserLocation(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** Asks for location permission (call only from a tap on "Use my location"). Null when it is refused or unavailable. */
export async function requestUserLocation(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** One venue, for a screen opened without the list (a push or a link). */
export async function loadFieldListing(supabase: SupabaseClient, key: string): Promise<FieldListing | null> {
  const hit = getCachedListing(key);
  if (hit) return hit;
  const { data, error } = await supabase.from("venues").select("*").eq("venue_key", key).maybeSingle();
  if (error || !data) return null;
  const connected = await connectedKeys(supabase);
  const listing = toListing(data as Venue, { connected: connected.has(key) });
  cache.set(key, listing);
  return listing;
}
