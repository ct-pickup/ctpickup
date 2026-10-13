import type { SupabaseClient } from "@supabase/supabase-js";
import * as Location from "expo-location";

import { FIELDS_SAMPLE_DATA } from "./config";
import { sortListings, toListing } from "./listings";
import { getSampleField, SAMPLE_FIELDS } from "./sampleData";
import type { FieldListing, Venue } from "./types";

const PAGE = 500;
/** Safety cap: more than this many venues means the list needs real bounding-box loading. */
const MAX_ROWS = 3000;

const cache = new Map<string, FieldListing>();

/** Loaded listing for a key (the list screen fills this), or the sample venue when the dev flag is on. */
export function getCachedListing(key: string | null | undefined): FieldListing | null {
  if (!key) return null;
  return cache.get(key) ?? (FIELDS_SAMPLE_DATA ? getSampleField(key) : null);
}

async function connectedKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("connected_venue_keys");
  // A failed lookup means nothing is connected: times then show Unknown, never Open.
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as unknown[]).map((k) => (typeof k === "string" ? k : String((k as { connected_venue_keys?: string })?.connected_venue_keys ?? ""))));
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

/** All venues, 500 rows per request, best first. ~350 CT venues is one request; the cap guards against a runaway table. */
export async function loadFieldListings(supabase: SupabaseClient, user: { lat: number; lon: number } | null): Promise<FieldListing[]> {
  if (FIELDS_SAMPLE_DATA) return SAMPLE_FIELDS;
  const rows: Venue[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .order("priority", { ascending: false, nullsFirst: false })
      .order("venue_key", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Venue[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const connected = await connectedKeys(supabase);
  const list = sortListings(rows.filter((v) => v.name).map((v) => toListing(v, { user, connected: connected.has(v.venue_key) })));
  cache.clear();
  list.forEach((f) => cache.set(f.venue.venue_key, f));
  return list;
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
