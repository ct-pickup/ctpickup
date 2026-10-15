import type { SupabaseClient } from "@supabase/supabase-js";
import * as Location from "expo-location";

import { addressLine, ilikeTerm, MIN_QUERY, type PlaceHit } from "@shared/fields/placeSearch";

/** Fields and schools in our own venues table whose name matches. Never throws. */
export async function searchVenues(supabase: SupabaseClient, query: string): Promise<PlaceHit[]> {
  const t = ilikeTerm(query);
  if (t.length < MIN_QUERY) return [];
  try {
    const { data, error } = await supabase
      .from("venues")
      .select("venue_key,name,school_name,address,state,lat,lon")
      .or(`name.ilike.%${t}%,school_name.ilike.%${t}%`)
      .not("lat", "is", null)
      .not("lon", "is", null)
      .limit(5);
    if (error || !data) return [];
    return (data as { venue_key: string; name: string; school_name: string | null; address: string | null; state: string | null; lat: number; lon: number }[]).map((v) => ({
      key: `v:${v.venue_key}`,
      label: v.name,
      sub: v.address ?? v.state,
      lat: v.lat,
      lon: v.lon,
      source: "venue" as const,
    }));
  } catch {
    return [];
  }
}

/** Addresses, schools and towns from the phone's own geocoder (no extra service). Never throws. */
export async function searchGeocoder(query: string): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  try {
    const found = (await Location.geocodeAsync(q)).slice(0, 4);
    return await Promise.all(
      found.map(async (f, i) => {
        const sub = await reverseLine(f.latitude, f.longitude);
        return { key: `p:${i}:${f.latitude.toFixed(5)},${f.longitude.toFixed(5)}`, label: i === 0 && !sub ? q : (sub ?? q), sub: null, lat: f.latitude, lon: f.longitude, source: "place" as const };
      }),
    );
  } catch {
    return [];
  }
}

/** The nearest street or town for a point, or null. */
export async function reverseLine(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    return addressLine(r[0]);
  } catch {
    return null;
  }
}
