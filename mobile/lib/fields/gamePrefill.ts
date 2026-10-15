import { closedBanner } from "./presentation";
import type { Venue } from "./types";

/**
 * "Create a game here": what the create-game screen starts with when it is opened from a field, or from an approved request.
 * Pure, so the rules are testable. The server checks the same rules again (lib/fields/gameAtField.ts).
 */

export type PrefillVenue = Pick<Venue, "venue_key" | "name" | "address" | "lat" | "lon" | "status" | "closed_until" | "closed_reason" | "permit_required" | "permit_type">;
export type PrefillRequest = { id: string; user_id?: string | null; venue_key: string; requested_date: string; start_time: string; status: string };

export type GamePrefill = {
  venue_key: string;
  /** Set only when an approved request of the signed-in player's is being used. */
  venue_request_id: string | null;
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  /** YYYY-MM-DD and HH:MM, or null: left empty for the captain to choose. */
  date: string | null;
  time: string | null;
  banner: string | null;
  /** "Closed until Mar 1, 2027" while that date is today or later. */
  closedWarning: string | null;
  /** Earliest date allowed (the closed-until date), or null. */
  minDate: string | null;
  /** Set when this field can't be used for a new game, or the request can't be used by this person. */
  blocked: string | null;
};

export function locationTextFor(v: Pick<Venue, "name" | "address">): string {
  const addr = (v.address ?? "").trim();
  return addr && !v.name.includes(addr) ? `${v.name}, ${addr}` : v.name;
}

export const FIELD_UNAVAILABLE = "This field isn’t available for new games.";
export const NOT_REQUEST_OWNER = "Only the person who made the request can create a game from it.";

export function buildGamePrefill(venue: PrefillVenue, request: PrefillRequest | null, userId: string | null, today: string): GamePrefill {
  const out: GamePrefill = {
    venue_key: venue.venue_key,
    venue_request_id: null,
    location_text: locationTextFor(venue),
    latitude: venue.lat ?? null,
    longitude: venue.lon ?? null,
    date: null,
    time: null,
    banner: null,
    closedWarning: closedBanner(venue, today),
    minDate: null,
    blocked: null,
  };
  if (out.closedWarning && venue.closed_until) out.minDate = venue.closed_until;
  if (venue.status && venue.status !== "active") out.blocked = FIELD_UNAVAILABLE;
  if (!request) return out;
  if (!userId || request.user_id !== userId) {
    out.blocked = NOT_REQUEST_OWNER;
    return out;
  }
  if (request.status !== "approved" || request.venue_key !== venue.venue_key) return out;
  out.venue_request_id = request.id;
  out.banner = "Your request for this field was approved.";
  // Only fill a date that hasn't passed, and never one the field is closed for.
  if (request.requested_date >= today && !dateBlockedByClosure(venue, request.requested_date)) {
    out.date = request.requested_date;
    out.time = request.start_time.slice(0, 5);
  }
  return out;
}

/** A message when the game's date is before the field's "closed until" date, else null. */
export function dateBlockedByClosure(venue: Pick<Venue, "closed_until">, date: string): string | null {
  const until = venue.closed_until?.trim();
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until) || date >= until) return null;
  return `This field is closed until ${until}. Pick a date on or after that.`;
}

/** Fields that usually need a permit: required, or a permit / reservation / school-use request. Membership and walk-up do not. */
export function needsPermit(v: Pick<Venue, "permit_required" | "permit_type">): boolean {
  if (v.permit_type === "walk_up") return false;
  return v.permit_required === "yes" || v.permit_type === "permit" || v.permit_type === "reservation" || v.permit_type === "school_use_request";
}

/** The request to offer on the field page: the player's own approved request for this field that is still upcoming and has no game yet. */
export function pickApprovedRequest(requests: PrefillRequest[], venueKey: string, userId: string, today: string, usedRequestIds: ReadonlySet<string>): PrefillRequest | null {
  return (
    requests
      .filter((r) => r.user_id === userId && r.venue_key === venueKey && r.status === "approved" && r.requested_date >= today && !usedRequestIds.has(r.id))
      .sort((a, b) => `${a.requested_date} ${a.start_time}`.localeCompare(`${b.requested_date} ${b.start_time}`))[0] ?? null
  );
}
