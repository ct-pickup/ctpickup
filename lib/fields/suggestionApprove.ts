import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCorrectionPatch, buildVenueFromSuggestion, type SuggestionRow } from "@/shared/fields/suggestions";

export type ApproveResult = "approved" | "already" | "missing" | "venue_missing";

/**
 * Applies a pending suggestion, then marks it approved. Safe to repeat: a new field uses a key built from the suggestion id (so a
 * retry rewrites the same row) and a correction sets the same values again. Server only (service role).
 *   new_venue  creates the venues row (source player, imports can never overwrite it)
 *   correction updates the changed columns on the venue and protects them
 */
export async function approveSuggestion(admin: SupabaseClient, suggestionId: string, reviewerId: string, nowIso: string = new Date().toISOString()): Promise<ApproveResult> {
  const { data, error } = await admin.from("venue_suggestions").select("*").eq("id", suggestionId).maybeSingle();
  if (error) throw new Error(error.message);
  const s = data as (SuggestionRow & { created_venue_key?: string | null }) | null;
  if (!s) return "missing";
  if (s.status !== "pending") return "already";

  let createdKey: string | null = null;
  if (s.kind === "new_venue") {
    const row = buildVenueFromSuggestion(s, nowIso);
    const { error: e } = await admin.from("venues").upsert(row, { onConflict: "venue_key" });
    if (e) throw new Error(e.message);
    createdKey = String(row.venue_key);
  } else {
    if (!s.venue_key) return "venue_missing";
    const { data: v, error: ve } = await admin.from("venues").select("venue_key,locked_fields,player_notes").eq("venue_key", s.venue_key).maybeSingle();
    if (ve) throw new Error(ve.message);
    if (!v) return "venue_missing";
    const patch = buildCorrectionPatch(s, v as { locked_fields?: string[] | null; player_notes?: string | null }, nowIso);
    const { error: e } = await admin.from("venues").update(patch).eq("venue_key", s.venue_key);
    if (e) throw new Error(e.message);
  }

  const { error: me } = await admin
    .from("venue_suggestions")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: nowIso, created_venue_key: createdKey })
    .eq("id", s.id);
  if (me) throw new Error(me.message);
  return "approved";
}

export async function rejectSuggestion(admin: SupabaseClient, suggestionId: string, reviewerId: string, nowIso: string = new Date().toISOString()): Promise<"rejected" | "already" | "missing"> {
  const { data, error } = await admin.from("venue_suggestions").select("id,status").eq("id", suggestionId).maybeSingle();
  if (error) throw new Error(error.message);
  const s = data as { id: string; status: string } | null;
  if (!s) return "missing";
  if (s.status !== "pending") return "already";
  const { error: e } = await admin.from("venue_suggestions").update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: nowIso }).eq("id", s.id);
  if (e) throw new Error(e.message);
  return "rejected";
}
