import type { SupabaseClient } from "@supabase/supabase-js";

import { FIELDS_SAMPLE_DATA } from "./config";
import { filterFields } from "./presentation";
import { nearbyParams, rowsToListings, type NearbyArgs, type NearbyRow } from "./nearby";
import { SAMPLE_FIELDS } from "./sampleData";
import type { FieldListing } from "./types";
import { connectedKeys, rememberListings } from "./venueStore";

export type NearbyResult = { items: FieldListing[]; total: number };

/** One page of venues in the map box (or matching a search), filtered and sorted by the database. */
export async function fetchNearby(supabase: SupabaseClient, args: NearbyArgs): Promise<NearbyResult> {
  if (FIELDS_SAMPLE_DATA) {
    const all = filterFields(SAMPLE_FIELDS, args.filters);
    return { items: all.slice(args.offset, args.offset + args.limit), total: all.length };
  }
  const { data, error } = await supabase.rpc("venues_nearby", nearbyParams(args));
  if (error) throw new Error(error.message);
  const connected = await connectedKeys(supabase);
  const res = rowsToListings((data ?? []) as NearbyRow[], { connected, fromUser: args.user != null });
  rememberListings(res.items);
  return res;
}
