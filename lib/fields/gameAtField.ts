import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rules for creating a game at a field. Server only. A game may name a field (venue_key) and the approved request it came from:
 *   - the field must exist and be active (not hidden for review, not removed)
 *   - a field marked "closed until" can't host a game that starts before that date
 *   - a request can only be used by the person who made it, once it is approved, and only for its own field, and only once
 */

type Row = Record<string, unknown>;
export type GameLinkInput = { venue_key?: string | null; venue_request_id?: string | null };

export type GameLinkError = { ok: false; status: number; code: "field_missing" | "field_unavailable" | "field_closed" | "request_missing" | "not_owner" | "not_approved" | "wrong_field" | "already_used"; error: string };
export type GameLinkOk = { ok: true; venue: Row | null; request: Row | null; venue_key: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string): string => {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}, ${y}`;
};

/** `startDate` is the game's date, YYYY-MM-DD in Eastern time. */
export function checkFieldForGame(venue: Row | null, startDate: string): GameLinkError | null {
  if (!venue) return { ok: false, status: 404, code: "field_missing", error: "That field no longer exists." };
  const status = venue.status;
  if (status && status !== "active") return { ok: false, status: 409, code: "field_unavailable", error: "This field isn’t available for new games." };
  const until = typeof venue.closed_until === "string" ? venue.closed_until : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(until) && startDate < until) {
    return { ok: false, status: 409, code: "field_closed", error: `This field is closed until ${fmtDate(until)}. Pick a date on or after that.` };
  }
  return null;
}

export function checkRequestForGame(request: Row | null, userId: string, venueKey: string | null, alreadyUsed: boolean): GameLinkError | null {
  if (!request) return { ok: false, status: 404, code: "request_missing", error: "That field request no longer exists." };
  if (request.user_id !== userId) return { ok: false, status: 403, code: "not_owner", error: "Only the person who made the request can create a game from it." };
  if (request.status !== "approved") return { ok: false, status: 409, code: "not_approved", error: "That request hasn’t been approved yet." };
  if (venueKey && request.venue_key !== venueKey) return { ok: false, status: 400, code: "wrong_field", error: "That request is for a different field." };
  if (alreadyUsed) return { ok: false, status: 409, code: "already_used", error: "A game was already created from this request." };
  return null;
}

/** Loads and checks the field and request a new game names. Returns what the insert should store, or the error to send. */
export async function resolveGameLink(admin: SupabaseClient, userId: string, input: GameLinkInput, startDate: string): Promise<GameLinkOk | GameLinkError> {
  const requestId = typeof input.venue_request_id === "string" && input.venue_request_id.trim() ? input.venue_request_id.trim() : null;
  let venueKey = typeof input.venue_key === "string" && input.venue_key.trim() ? input.venue_key.trim() : null;
  let request: Row | null = null;

  if (requestId) {
    const { data, error } = await admin.from("venue_requests").select("id,user_id,venue_key,status,requested_date,start_time").eq("id", requestId).maybeSingle();
    if (error) throw new Error(error.message);
    request = (data as Row | null) ?? null;
    // Check the owner before anything else about it is revealed.
    if (request && request.user_id !== userId) return checkRequestForGame(request, userId, venueKey, false)!;
    const { data: used, error: ue } = await admin.from("pickup_runs").select("id").eq("venue_request_id", requestId);
    if (ue) throw new Error(ue.message);
    const bad = checkRequestForGame(request, userId, venueKey, ((used ?? []) as Row[]).length > 0);
    if (bad) return bad;
    venueKey = (request!.venue_key as string) ?? venueKey;
  }
  if (!venueKey) return { ok: true, venue: null, request: null, venue_key: null };

  const { data: v, error: ve } = await admin.from("venues").select("venue_key,name,address,lat,lon,status,closed_until").eq("venue_key", venueKey).maybeSingle();
  if (ve) throw new Error(ve.message);
  const venue = (v as Row | null) ?? null;
  const badField = checkFieldForGame(venue, startDate);
  if (badField) return badField;
  return { ok: true, venue, request, venue_key: venueKey };
}
