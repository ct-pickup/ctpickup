import type { SupabaseClient } from "@supabase/supabase-js";

import { pickApprovedRequest, type PrefillRequest } from "./gamePrefill";

/** Request ids that already have a game. Quietly empty if the games link column is not there yet. */
export async function requestIdsWithGames(supabase: SupabaseClient, requestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (requestIds.length === 0) return out;
  const { data, error } = await supabase.from("pickup_runs").select("id,venue_request_id").in("venue_request_id", requestIds);
  if (error) return out;
  for (const r of (data ?? []) as { id: string; venue_request_id: string | null }[]) if (r.venue_request_id) out.set(r.venue_request_id, r.id);
  return out;
}

/** The player's next approved request for this field that has no game yet, or null. Reads only their own rows (RLS). */
export async function fetchApprovedRequest(supabase: SupabaseClient, userId: string, venueKey: string, today: string): Promise<PrefillRequest | null> {
  const { data, error } = await supabase
    .from("venue_requests")
    .select("id,user_id,venue_key,requested_date,start_time,duration_hours,status")
    .eq("user_id", userId)
    .eq("venue_key", venueKey)
    .eq("status", "approved")
    .gte("requested_date", today)
    .order("requested_date", { ascending: true })
    .limit(10);
  if (error) return null;
  const rows = (data ?? []) as PrefillRequest[];
  const used = await requestIdsWithGames(supabase, rows.map((r) => r.id));
  return pickApprovedRequest(rows, venueKey, userId, today, new Set(used.keys()));
}
