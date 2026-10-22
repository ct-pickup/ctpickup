import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchNearby } from "./nearbyApi";
import { NO_FIELD_FILTERS, type FieldListing } from "./types";
import { bboxAround, DUPLICATE_RADIUS_M, findDuplicates, type SuggestionKind, type SuggestionProblem, type VenueSettingValue } from "@shared/fields/suggestions";

export type SuggestionInput = {
  kind: SuggestionKind;
  venue_key?: string | null;
  problem?: SuggestionProblem | null;
  lat?: number | null;
  lon?: number | null;
  name?: string | null;
  setting?: VenueSettingValue | null;
  surface?: string | null;
  price_note?: string | null;
  permit_note?: string | null;
  website?: string | null;
  note?: string | null;
};

export type SubmitResult = { ok: true } | { ok: false; code: "rate_limited" | "error"; message: string };

function nullIfBlank<T extends string | null | undefined>(v: T): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Saves a suggestion as the signed-in player. Row-level security only lets them write their own, as pending. */
export async function submitSuggestion(supabase: SupabaseClient, userId: string, s: SuggestionInput): Promise<SubmitResult> {
  const { error } = await supabase.from("venue_suggestions").insert({
    user_id: userId,
    kind: s.kind,
    venue_key: s.venue_key ?? null,
    problem: s.problem ?? null,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    name: nullIfBlank(s.name),
    setting: s.setting ?? null,
    surface: nullIfBlank(s.surface),
    price_note: nullIfBlank(s.price_note),
    permit_note: nullIfBlank(s.permit_note),
    website: nullIfBlank(s.website),
    note: nullIfBlank(s.note),
  });
  if (!error) return { ok: true };
  if (/venue_suggestion_rate_limit/.test(error.message ?? "")) {
    return { ok: false, code: "rate_limited", message: "You already have 10 suggestions waiting for review. We’ll get to them first." };
  }
  return { ok: false, code: "error", message: "We couldn’t save that. Please try again." };
}

export type NearbyField = { listing: FieldListing; meters: number };

/** Existing fields within about 150 m of a pin, nearest first. One venues_nearby() call over a small box, then an exact distance check. */
export async function findNearbyFields(supabase: SupabaseClient, lat: number, lon: number, meters: number = DUPLICATE_RADIUS_M): Promise<NearbyField[]> {
  const b = bboxAround(lat, lon, meters);
  const region = { latitude: lat, longitude: lon, latitudeDelta: b.maxLat - b.minLat, longitudeDelta: b.maxLon - b.minLon };
  const res = await fetchNearby(supabase, { region, user: null, filters: NO_FIELD_FILTERS, limit: 50, offset: 0 });
  return findDuplicates(res.items.map((listing) => ({ listing, lat: listing.venue.lat, lon: listing.venue.lon })), lat, lon, meters).map((d) => ({ listing: d.listing, meters: d.meters }));
}

export type ConfirmationState = { count: number; mine: boolean };

export async function fetchConfirmation(supabase: SupabaseClient, venueKey: string, userId: string): Promise<ConfirmationState> {
  const [counts, mine] = await Promise.all([
    supabase.rpc("venue_confirmation_counts", { p_keys: [venueKey] }),
    supabase.from("venue_confirmations").select("venue_key", { count: "exact", head: true }).eq("venue_key", venueKey).eq("user_id", userId),
  ]);
  const row = (Array.isArray(counts.data) ? counts.data[0] : null) as { confirmations?: number | string } | null;
  return { count: counts.error ? 0 : Number(row?.confirmations ?? 0), mine: !mine.error && (mine.count ?? 0) > 0 };
}

/** "Looks right". A player can confirm a field once: a second try hits the primary key and counts as already confirmed. */
export async function confirmVenue(supabase: SupabaseClient, venueKey: string, userId: string): Promise<"confirmed" | "already" | "error"> {
  const { error } = await supabase.from("venue_confirmations").insert({ venue_key: venueKey, user_id: userId });
  if (!error) return "confirmed";
  return (error as { code?: string }).code === "23505" ? "already" : "error";
}
