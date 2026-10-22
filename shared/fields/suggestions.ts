/**
 * Player suggestions for the Fields feature: new fields and corrections. Pure rules shared by the app (duplicate check, form
 * checks) and the server (what an approved suggestion writes to the venues table). No imports, no network.
 */

export type SuggestionKind = "new_venue" | "correction";
export type VenueSettingValue = "indoor" | "outdoor" | "both";
export type SuggestionProblem =
  | "wrong_price"
  | "wrong_permit"
  | "wrong_location"
  | "wrong_setting"
  | "closed"
  | "other"
  | "doesnt_exist"
  | "private"
  | "not_soccer"
  | "duplicate"
  | "wrong_info";

export const PROBLEMS: { key: SuggestionProblem; label: string }[] = [
  { key: "wrong_price", label: "Wrong price" },
  { key: "wrong_permit", label: "Wrong permit info" },
  { key: "wrong_setting", label: "Indoor or outdoor is wrong" },
  { key: "wrong_location", label: "Wrong location" },
  { key: "closed", label: "Closed or gone" },
  { key: "other", label: "Something else" },
  { key: "doesnt_exist", label: "Doesn’t exist / removed" },
  { key: "private", label: "Private or not open to the public" },
  { key: "not_soccer", label: "Not a soccer field" },
  { key: "duplicate", label: "Duplicate of another field" },
  { key: "wrong_info", label: "Wrong price / permit / contact info" },
];

/** What a player can pick in "Report a problem", in the order shown. */
export const REPORT_REASONS: { key: SuggestionProblem; label: string }[] = [
  { key: "doesnt_exist", label: "Doesn’t exist / removed" },
  { key: "closed", label: "Closed (permanently, or for the season / construction)" },
  { key: "wrong_location", label: "Wrong location" },
  { key: "private", label: "Private or not open to the public" },
  { key: "not_soccer", label: "Not a soccer field" },
  { key: "duplicate", label: "Duplicate of another field" },
  { key: "wrong_info", label: "Wrong price / permit / contact info" },
];

/** Three different players saying one of these hides the field until an admin looks. */
export const AUTO_HIDE_REASONS: SuggestionProblem[] = ["doesnt_exist", "not_soccer"];
export const AUTO_HIDE_PLAYERS = 3;

export function problemLabel(p: string | null | undefined): string {
  return PROBLEMS.find((x) => x.key === p)?.label ?? "Correction";
}

/** What a player can propose. The same shape as a venue_suggestions row. */
export type SuggestionRow = {
  id: string;
  user_id: string;
  kind: SuggestionKind;
  venue_key: string | null;
  problem: SuggestionProblem | null;
  lat: number | null;
  lon: number | null;
  name: string | null;
  setting: VenueSettingValue | null;
  surface: string | null;
  price_note: string | null;
  permit_note: string | null;
  website: string | null;
  note: string | null;
  /** The short text for "Wrong price / permit / contact info". */
  detail?: string | null;
  /** The other field, for "Duplicate of another field". */
  duplicate_of?: string | null;
  status: "pending" | "approved" | "rejected";
};

/** Columns an import must never overwrite on a venue a player or admin has touched (see upsert_venues). */
export const LOCKABLE_FIELDS = ["name", "lat", "lon", "setting", "surface", "lit", "address", "website"] as const;

export const SUGGESTION_MAX_PENDING = 10;

// ---------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------

/** Within this many meters of a new pin, an existing field might be the same place. */
export const DUPLICATE_RADIUS_M = 150;

const EARTH_M = 6_371_000;

export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A box around a point, a little larger than the radius, for one venues_nearby() call. */
export function bboxAround(lat: number, lon: number, meters: number) {
  const dLat = (meters * 1.5) / 111_000;
  const dLon = (meters * 1.5) / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/** Existing fields within `radius` meters of the pin, nearest first, each with its distance. */
export function findDuplicates<T extends { lat: number | null; lon: number | null }>(candidates: T[], lat: number, lon: number, radius: number = DUPLICATE_RADIUS_M): (T & { meters: number })[] {
  return candidates
    .filter((c): c is T & { lat: number; lon: number } => c.lat != null && c.lon != null)
    .map((c) => ({ ...c, meters: metersBetween(lat, lon, c.lat, c.lon) }))
    .filter((c) => c.meters <= radius)
    .sort((a, b) => a.meters - b.meters);
}

// ---------------------------------------------------------------------------
// Form checks
// ---------------------------------------------------------------------------

/** "example.com" -> "https://example.com". Null when it does not look like a web address. */
export function normalizeWebsite(input: string | null | undefined): string | null {
  const t = (input ?? "").trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

export type NewVenueDraft = { name: string; lat: number | null; lon: number | null; setting: VenueSettingValue | null; website?: string };

/** The first thing wrong with a new-field draft, or null. */
export function newVenueProblem(d: NewVenueDraft): string | null {
  if (d.lat == null || d.lon == null) return "Drop the pin on the field first.";
  if (clean(d.name) == null || d.name.trim().length < 2) return "Give the field a name.";
  if (d.name.trim().length > 200) return "That name is too long.";
  if (!d.setting) return "Choose indoor, outdoor or both.";
  if (clean(d.website) && normalizeWebsite(d.website) == null) return "That website doesn’t look right.";
  return null;
}

// ---------------------------------------------------------------------------
// What an approved suggestion writes
// ---------------------------------------------------------------------------

/** Free text like "Free", "$40/hr", "$25 per hour", "$120" into structured price columns. Always keeps the original as price_text. */
export function parsePriceNote(note: string | null | undefined): Record<string, unknown> | null {
  const t = clean(note);
  if (!t) return null;
  const out: Record<string, unknown> = { price_text: t };
  if (/^\s*free\b/i.test(t) || /\bno (cost|charge|fee)\b/i.test(t)) {
    out.price_status = "free";
    out.price_min = null;
    out.price_max = null;
    out.price_unit = null;
    return out;
  }
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(t);
  if (m) {
    out.price_status = "paid";
    out.price_min = Number(m[1]);
    out.price_max = Number(m[1]);
    out.price_unit = /\/\s*(hr|hour|h)\b|\bper\s*(hr|hour)\b|\bhourly\b/i.test(t) ? "hour" : null;
  }
  return out;
}

/** Free text about permits into the structured permit columns when the words are clear. Unclear text sets nothing structured. */
export function parsePermitNote(note: string | null | undefined): Record<string, unknown> {
  const t = (clean(note) ?? "").toLowerCase();
  if (!t) return {};
  if (/\bno permit\b|\bwalk[- ]?up\b|\bopen to (the )?public\b|\bno reservation\b/.test(t)) return { permit_required: "no", permit_type: "walk_up" };
  if (/\bmember/.test(t)) return { permit_required: "yes", permit_type: "membership" };
  if (/\breserv/.test(t)) return { permit_required: "yes", permit_type: "reservation" };
  if (/\bschool\b|\bfacility[- ]use\b/.test(t)) return { permit_required: "yes", permit_type: "school_use_request" };
  if (/\bpermit\b/.test(t)) return { permit_required: "yes", permit_type: "permit" };
  return {};
}

function noteLines(s: SuggestionRow, when: string): string {
  const parts = [s.note, s.detail ? `Detail: ${s.detail}` : null, s.price_note ? `Price: ${s.price_note}` : null, s.permit_note ? `Permit: ${s.permit_note}` : null].map(clean).filter(Boolean);
  return parts.length ? `[${when}] ${parts.join(" | ")}` : "";
}

export function appendNotes(existing: string | null | undefined, line: string): string | null {
  const base = clean(existing);
  if (!line) return base;
  return base ? `${base}\n${line}` : line;
}

export function mergeLocked(existing: readonly string[] | null | undefined, add: readonly string[]): string[] {
  return [...new Set([...(existing ?? []), ...add])];
}

export function newVenueKey(suggestionId: string): string {
  return `player-${suggestionId}`;
}

/**
 * The venues row for an approved new_venue suggestion. The key comes from the suggestion id, so approving twice writes the same
 * row. source = player, and every lockable column is locked so an import can never overwrite it. verified stays false: nobody has
 * checked the price or permit, so the app must not call them Verified.
 */
export function buildVenueFromSuggestion(s: SuggestionRow, nowIso: string): Record<string, unknown> {
  const price = parsePriceNote(s.price_note) ?? {};
  const permit = parsePermitNote(s.permit_note);
  return {
    venue_key: newVenueKey(s.id),
    state: null,
    name: (s.name ?? "").trim(),
    lat: s.lat,
    lon: s.lon,
    venue_type: "other",
    access: "unknown",
    surface: clean(s.surface),
    website: normalizeWebsite(s.website),
    setting: s.setting ?? "outdoor",
    sport_confidence: "player",
    priority: 1,
    price_status: "unknown",
    price_source: s.price_note ? "manual" : "unknown",
    ...price,
    permit_required: "unknown",
    ...(s.permit_note ? { permit_basis: "manual" } : {}),
    ...permit,
    booking_method: "unknown",
    verified: false,
    source: "player",
    locked_fields: [...LOCKABLE_FIELDS],
    player_notes: noteLines(s, nowIso.slice(0, 10)) || null,
    updated_at: nowIso,
  };
}

/**
 * The columns an approved correction changes on an existing venue, and the new locked_fields. Price and permit corrections use
 * the existing hand-entered markers (price_source / permit_basis = manual), which upsert_venues already protects; the other
 * columns are added to locked_fields. The free-text notes are also appended to player_notes for the record.
 */
export function buildCorrectionPatch(s: SuggestionRow, venue: { locked_fields?: string[] | null; player_notes?: string | null }, nowIso: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const locked: string[] = [];
  const name = clean(s.name);
  if (name) {
    patch.name = name;
    locked.push("name");
  }
  if (s.setting) {
    patch.setting = s.setting;
    locked.push("setting");
  }
  const surface = clean(s.surface);
  if (surface) {
    patch.surface = surface;
    locked.push("surface");
  }
  const website = normalizeWebsite(s.website);
  if (website) {
    patch.website = website;
    locked.push("website");
  }
  if (s.lat != null && s.lon != null) {
    patch.lat = s.lat;
    patch.lon = s.lon;
    locked.push("lat", "lon");
  }
  const price = parsePriceNote(s.price_note);
  if (price) {
    Object.assign(patch, price, { price_source: "manual" });
  }
  if (clean(s.permit_note)) {
    Object.assign(patch, parsePermitNote(s.permit_note), { permit_basis: "manual" });
  }
  const closed = s.problem === "closed" ? "Reported closed or gone. " : "";
  const line = noteLines(s, nowIso.slice(0, 10));
  patch.player_notes = appendNotes(venue.player_notes, line ? `${closed}${line}`.trim() : closed.trim());
  patch.locked_fields = mergeLocked(venue.locked_fields, locked);
  patch.updated_at = nowIso;
  return patch;
}

/** "Confirmed by 3 players", "Confirmed by 1 player", or null. */
export function confirmationLabel(count: number): string | null {
  if (!count || count < 1) return null;
  return `Confirmed by ${count} ${count === 1 ? "player" : "players"}`;
}
