/**
 * Pure helpers for scripts/import-research.ts: CSV reading, row cleanup, matching a researched field to a venue we already have,
 * and building what to write. No network, no env, no secrets. Rules, in short:
 *   - a match is within 150 m AND a similar name, or within 40 m whatever the name
 *   - a matched venue only gets values it does not already have (empty or "unknown"), keeps its name, and the filled columns are locked
 *   - nothing here ever sets price_source = manual or verified = true (the app shows that as Verified)
 */
import { createHash } from "node:crypto";

export type Venue = Record<string, unknown> & { venue_key: string; name: string; lat: number | null; lon: number | null };

export const NEAR_WITH_NAME_M = 150;
export const NEAR_ANY_NAME_M = 40;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 style: quoted fields, doubled quotes, newlines inside quotes, CRLF, optional BOM. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export const RESEARCH_COLUMNS = [
  "name", "venue_type", "operator", "town", "county", "address", "setting", "surface", "field_count", "lit", "free_or_paid", "price_text",
  "price_unit", "permit_required", "permit_issuer", "how_to_book", "booking_url", "contact_email", "contact_phone", "residency_rule",
  "availability_notes", "source_url", "source_date", "confidence",
] as const;
export type ResearchRaw = Record<(typeof RESEARCH_COLUMNS)[number], string>;

/** Header + rows into objects. Throws if a column the importer cannot work without is missing. */
export function readResearchCsv(text: string): { rows: ResearchRaw[]; missing: string[] } {
  const all = parseCsv(text);
  if (all.length === 0) return { rows: [], missing: [...RESEARCH_COLUMNS] };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const missing = RESEARCH_COLUMNS.filter((c) => !header.includes(c));
  for (const need of ["name", "address", "town"]) if (!header.includes(need)) throw new Error(`The CSV has no "${need}" column.`);
  const rows = all.slice(1).map((cells) => {
    const o = {} as ResearchRaw;
    for (const c of RESEARCH_COLUMNS) {
      const i = header.indexOf(c);
      o[c] = i >= 0 ? (cells[i] ?? "").trim() : "";
    }
    return o;
  });
  return { rows, missing };
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Cleaning one row
// ---------------------------------------------------------------------------

const UNKNOWN = /^(|unknown|unk|n\/a|na|none|tbd|\?|not (known|sure|listed|available))$/i;
export const isUnknown = (v: string | null | undefined): boolean => UNKNOWN.test((v ?? "").trim());

export type Tri = "yes" | "no" | "unknown";
export function triState(v: string): Tri {
  const s = v.trim().toLowerCase();
  if (/^(y|yes|true|required|needed)\b/.test(s)) return "yes";
  if (/^(n|no|false|none|not required)\b/.test(s)) return "no";
  return "unknown";
}

export function stateFromFilename(file: string): string | null {
  const m = /^([a-z]{2})_/i.exec(file.split(/[\\/]/).pop() ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

/** "45 River Rd, Fairfield, CT": the address, then the town, then the state, without repeating what the address already says. */
export function geocodeQuery(r: Pick<ResearchRaw, "address" | "town">, state: string | null): string | null {
  const address = r.address.trim();
  if (!address) return null;
  const parts = [address];
  const hasTown = r.town.trim() && address.toLowerCase().includes(r.town.trim().toLowerCase());
  if (r.town.trim() && !hasTown) parts.push(r.town.trim());
  if (state && !new RegExp(`\\b${state}\\b`).test(address)) parts.push(state);
  return parts.join(", ");
}

export type Price = { status: "free" | "paid" | "unknown"; text: string | null; min: number | null; max: number | null; unit: string | null };

export function parsePrice(r: Pick<ResearchRaw, "free_or_paid" | "price_text" | "price_unit">): Price {
  const text = r.price_text.trim() || null;
  const fp = r.free_or_paid.trim().toLowerCase();
  const nums = [...(text ?? "").matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  let status: Price["status"] = "unknown";
  if (/^free/.test(fp)) status = "free";
  else if (/^(paid|fee|pay)/.test(fp) || (fp === "" && nums.length > 0) || (/^(mixed|both)/.test(fp) && nums.length > 0)) status = "paid";
  else if (fp === "" && text && /^free\b/i.test(text)) status = "free";
  if (status === "unknown") return { status, text: null, min: null, max: null, unit: null };
  if (status === "free") return { status, text, min: null, max: null, unit: null };
  const u = `${r.price_unit} ${text ?? ""}`.toLowerCase();
  const unit = /\b(hour|hr|h)\b|\/\s*h/.test(u) ? "hour" : /\bday\b/.test(u) ? "day" : /\bgame\b/.test(u) ? "game" : /\bseason\b/.test(u) ? "season" : /\bperson|player\b/.test(u) ? "person" : null;
  return { status, text, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null, unit };
}

export type Booking = { method: "online" | "phone" | "permit_request" | "unknown"; url: string | null; phone: string | null; basis: string | null };
export function parseBooking(r: Pick<ResearchRaw, "how_to_book" | "booking_url" | "contact_phone" | "permit_required">): Booking {
  const url = /^https?:\/\//i.test(r.booking_url.trim()) ? r.booking_url.trim() : null;
  const phone = r.contact_phone.trim() || null;
  const how = r.how_to_book.trim();
  let method: Booking["method"] = "unknown";
  if (url) method = "online";
  else if (phone && /\b(call|phone|ring|text)\b/i.test(how)) method = "phone";
  else if (/permit/i.test(how)) method = "permit_request";
  return { method, url, phone, basis: how ? `research: ${how.slice(0, 200)}` : null };
}

export type Clean = {
  name: string;
  state: string | null;
  query: string | null;
  setting: "outdoor" | "indoor" | "both";
  surface: string | null;
  lit: "yes" | "no" | null;
  fieldCount: number | null;
  price: Price;
  permit: { required: Tri; issuer: string | null };
  booking: Booking;
  lowConfidence: boolean;
  /** Website for the venue's own website column (facility schema). */
  website: string | null;
  /** Operator or chain, used for a new venue's operator column. */
  operator: string | null;
  /** permit_type to use when permit_required is yes (membership for a members-only facility). Default "permit". */
  permitType: "permit" | "membership";
  /** Things with no column of their own (hours, minimum booking, pickup, email...), kept in the admin notes. */
  extraNotes: string[];
  /** The price text looked like party or package pricing, so it was not used as a field rental price. */
  priceGuarded: boolean;
  raw: ResearchRaw;
};

export function cleanRow(raw: ResearchRaw, fileState: string | null): Clean {
  const addrState = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(raw.address)?.[1] ?? null;
  const state = fileState ?? addrState;
  const setting = /^indoor/i.test(raw.setting) ? "indoor" : /^(both|mixed|indoor\s*\+|indoor and outdoor)/i.test(raw.setting) ? "both" : "outdoor";
  const lit = triState(raw.lit);
  const fc = Number.parseInt(raw.field_count, 10);
  return {
    name: raw.name.trim(),
    state,
    query: geocodeQuery(raw, state),
    setting,
    surface: isUnknown(raw.surface) ? null : raw.surface.trim().toLowerCase(),
    lit: lit === "unknown" ? null : lit,
    fieldCount: Number.isFinite(fc) && fc > 0 ? fc : null,
    price: parsePrice(raw),
    permit: { required: triState(raw.permit_required), issuer: isUnknown(raw.permit_issuer) ? null : raw.permit_issuer.trim() },
    booking: parseBooking(raw),
    lowConfidence: /^low\b/i.test(raw.confidence.trim()),
    website: null,
    operator: raw.operator.trim() || null,
    permitType: "permit",
    extraNotes: [],
    priceGuarded: false,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Indoor / private facility schema (*_soccer_facilities_*.csv)
// ---------------------------------------------------------------------------

export const FACILITY_COLUMNS = [
  "name", "operator_or_chain", "address", "town", "county", "setting", "surface", "field_count", "field_sizes", "price_text", "price_unit",
  "min_booking", "pickup_or_dropin", "pickup_price", "membership_required", "booking_url", "phone", "email", "website", "hours",
  "source_url", "source_date", "confidence",
] as const;
export type FacilityRaw = Record<(typeof FACILITY_COLUMNS)[number], string>;

export const isFacilityFile = (file: string): boolean => /_soccer_facilities_[^\\/]*\.csv$/i.test(file);
export const isOutdoorFile = (file: string): boolean => /_outdoor_soccer_fields\.csv$/i.test(file);

export function readFacilityCsv(text: string): { rows: FacilityRaw[]; missing: string[] } {
  const all = parseCsv(text);
  if (all.length === 0) return { rows: [], missing: [...FACILITY_COLUMNS] };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const missing = FACILITY_COLUMNS.filter((c) => !header.includes(c));
  for (const need of ["name", "address", "town"]) if (!header.includes(need)) throw new Error(`The CSV has no "${need}" column.`);
  const rows = all.slice(1).map((cells) => {
    const o = {} as FacilityRaw;
    for (const c of FACILITY_COLUMNS) {
      const i = header.indexOf(c);
      o[c] = i >= 0 ? (cells[i] ?? "").trim() : "";
    }
    return o;
  });
  return { rows, missing };
}

/** Birthday party, party room or package pricing is not what a team pays to rent a field. */
export const PACKAGE_PRICE = /\b(birthday|b-?day|party|parties|package|packages)\b/i;

const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, "; ").trim();

/** A facility row as a Clean row, so matching, filling, locking and notes work exactly as for the outdoor schema. */
export function cleanFacilityRow(f: FacilityRaw, fileState: string | null): Clean {
  const guarded = f.price_text.trim() !== "" && PACKAGE_PRICE.test(f.price_text);
  const asOutdoor = {
    name: f.name, venue_type: "", operator: f.operator_or_chain, town: f.town, county: f.county, address: f.address, setting: f.setting,
    surface: f.surface, field_count: f.field_count, lit: "", free_or_paid: "", price_text: guarded ? "" : f.price_text, price_unit: f.price_unit,
    permit_required: "", permit_issuer: "", how_to_book: "", booking_url: f.booking_url, contact_email: f.email, contact_phone: f.phone,
    residency_rule: "", availability_notes: "", source_url: f.source_url, source_date: f.source_date, confidence: f.confidence,
  } as ResearchRaw;
  const c = cleanRow(asOutdoor, fileState);
  const members = triState(f.membership_required) === "yes";
  const url = /^https?:\/\//i.test(f.booking_url.trim()) ? f.booking_url.trim() : null;
  const phone = f.phone.trim() || null;
  const extra: string[] = [];
  if (guarded) extra.push(`Price text (party or package pricing, not used as a rental price): ${oneLine(f.price_text)}`);
  if (f.field_sizes.trim()) extra.push(`Field sizes: ${oneLine(f.field_sizes)}`);
  if (f.min_booking.trim() && !isUnknown(f.min_booking)) extra.push(`Minimum booking: ${oneLine(f.min_booking)}`);
  if (f.hours.trim() && !isUnknown(f.hours)) extra.push(`Hours: ${oneLine(f.hours)}`);
  const pickup = [f.pickup_or_dropin.trim(), f.pickup_price.trim() ? `price ${f.pickup_price.trim()}` : ""].filter((x) => x && !isUnknown(x)).join(", ");
  if (pickup) extra.push(`Pickup / drop-in: ${oneLine(pickup)}`);
  if (members) extra.push("Membership required");
  if (f.operator_or_chain.trim()) extra.push(`Operator: ${oneLine(f.operator_or_chain)}`);
  return {
    ...c,
    website: /^https?:\/\//i.test(f.website.trim()) ? f.website.trim() : f.website.trim() ? `https://${f.website.trim()}` : null,
    operator: f.operator_or_chain.trim() || null,
    permit: members ? { required: "yes", issuer: null } : c.permit,
    permitType: members ? "membership" : "permit",
    booking: { method: url ? "online" : phone ? "phone" : "unknown", url, phone, basis: url || phone ? "research: facility listing" : null },
    price: guarded ? { status: "unknown", text: null, min: null, max: null, unit: null } : c.price,
    priceGuarded: guarded,
    extraNotes: extra,
    raw: { ...asOutdoor, price_text: oneLine(guarded ? "" : f.price_text) },
  };
}

// ---------------------------------------------------------------------------
// Skip list (data/research/skip.json): rows that are not soccer
// ---------------------------------------------------------------------------

const normName = (s: string): string => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Accepts ["Name", ...] or { "names": ["Name", ...] }. Anything else is an error, so a typo does not silently skip nothing. */
export function parseSkipList(json: unknown): string[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? (json as { names?: unknown }).names : undefined;
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) throw new Error('skip.json must be a list of names, or { "names": [...] }.');
  return list.map((x) => (x as string).trim()).filter(Boolean);
}

/** True when the row's name is a skip-list name (ignoring case, punctuation and "&" / "and"), alone or inside a longer name. */
export function isSkipped(name: string, skip: string[]): boolean {
  const n = normName(name);
  return skip.some((s) => {
    const k = normName(s);
    return k.trim() !== "" && n.includes(k);
  });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const EARTH_M = 6_371_000;
export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const STOP = new Set(["field", "fields", "park", "parks", "school", "schools", "the", "of", "and", "a", "at", "complex", "recreation", "recreational", "rec", "area", "athletic", "athletics", "soccer", "turf", "playground", "playgrounds", "center", "centre"]);

export function nameTokens(name: string): string[] {
  const t = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = t.filter((w) => !STOP.has(w));
  return kept.length > 0 ? kept : t;
}

/** Same place by name: identical words once filler like "field" and "park" is dropped, or one name's words all appear in the other, or half the words overlap. */
export function namesSimilar(a: string, b: string): boolean {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = [...ta].filter((w) => tb.has(w)).length;
  if (shared === 0) return false;
  if (shared === ta.size || shared === tb.size) return true;
  return shared / (ta.size + tb.size - shared) >= 0.5;
}

export type Match = { venue: Venue; meters: number; reason: "near + similar name" | "very near" };

/** Grid index so a state's worth of venues is searched quickly. Cells are 0.01 degrees. */
export class VenueIndex {
  private cells = new Map<string, Venue[]>();
  private key(lat: number, lon: number): string {
    return `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
  }
  add(v: Venue): void {
    if (v.lat == null || v.lon == null) return;
    const k = this.key(v.lat, v.lon);
    const list = this.cells.get(k);
    if (list) list.push(v);
    else this.cells.set(k, [v]);
  }
  near(lat: number, lon: number, meters: number): { venue: Venue; meters: number }[] {
    const out: { venue: Venue; meters: number }[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        for (const v of this.cells.get(`${Math.floor(lat * 100) + dy}:${Math.floor(lon * 100) + dx}`) ?? []) {
          const m = metersBetween(lat, lon, v.lat!, v.lon!);
          if (m <= meters) out.push({ venue: v, meters: m });
        }
      }
    return out.sort((a, b) => a.meters - b.meters);
  }
}

/** The venue this researched field is, or null. Nearest wins; a similar name within 150 m beats a different name within 40 m. */
export function findMatch(name: string, lat: number, lon: number, index: VenueIndex): Match | null {
  const near = index.near(lat, lon, NEAR_WITH_NAME_M);
  const named = near.find((n) => namesSimilar(name, n.venue.name));
  if (named) return { ...named, reason: "near + similar name" };
  const close = near.find((n) => n.meters <= NEAR_ANY_NAME_M);
  return close ? { ...close, reason: "very near" } : null;
}

// ---------------------------------------------------------------------------
// What to write
// ---------------------------------------------------------------------------

const empty = (v: unknown): boolean => v == null || (typeof v === "string" && (v.trim() === "" || v.trim().toLowerCase() === "unknown"));

export function venueKeyFor(name: string, address: string): string {
  const norm = `${name}|${address}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim();
  return `research-${createHash("sha1").update(norm).digest("hex").slice(0, 12)}`;
}

const START = "[research]";
const END = "[/research]";

/** The admin-only notes block: where the numbers came from and the things the app has no column for. */
export function notesBlock(c: Clean): string {
  const r = c.raw;
  const lines = [START];
  const src = [r.source_url.trim(), r.source_date.trim() ? `(${r.source_date.trim()})` : ""].filter(Boolean).join(" ");
  lines.push(`Source: ${src || "not given"}`);
  lines.push(c.lowConfidence ? "LOW CONFIDENCE: check before relying on this." : `Confidence: ${r.confidence.trim() || "not given"}`);
  if (r.price_text.trim()) lines.push(`Price (unconfirmed): ${r.price_text.trim()}`);
  for (const e of c.extraNotes) lines.push(e);
  if (r.residency_rule.trim() && !isUnknown(r.residency_rule)) lines.push(`Residency: ${r.residency_rule.trim()}`);
  if (r.availability_notes.trim() && !isUnknown(r.availability_notes)) lines.push(`Availability: ${r.availability_notes.trim()}`);
  if (c.permit.issuer) lines.push(`Permit issuer: ${c.permit.issuer}`);
  if (r.how_to_book.trim()) lines.push(`How to book: ${r.how_to_book.trim()}`);
  const contact = [r.contact_email.trim(), r.contact_phone.trim()].filter(Boolean).join(" · ");
  if (contact) lines.push(`Contact: ${contact}`);
  lines.push(END);
  return lines.join("\n");
}

/** Replaces the earlier research block in the notes (so re-runs do not pile up), keeping everything else. */
export function mergeNotes(existing: string | null | undefined, block: string): string {
  const base = (existing ?? "").replace(/\[research\][\s\S]*?\[\/research\]\n?/g, "").trim();
  return base ? `${base}\n${block}` : block;
}

export const ALL_LOCKS = ["name", "lat", "lon", "setting", "surface", "lit", "address", "website", "price", "permit", "booking"];

export function mergeLocks(existing: unknown, add: string[]): string[] {
  const cur = Array.isArray(existing) ? (existing as string[]) : [];
  return [...new Set([...cur, ...add])];
}

/**
 * The columns to change on an existing venue: only ones that are empty or unknown today, and only when the research has a real
 * value. Never the name, never price_source, never verified. Returns {} when there is nothing new.
 */
export function fillPatch(venue: Venue, c: Clean): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const locks: string[] = [];

  if (empty(venue.price_status) && c.price.status !== "unknown") {
    patch.price_status = c.price.status;
    if (c.price.text) patch.price_text = c.price.text;
    if (c.price.min != null) patch.price_min = c.price.min;
    if (c.price.max != null) patch.price_max = c.price.max;
    if (c.price.unit) patch.price_unit = c.price.unit;
    locks.push("price");
  }
  if (empty(venue.permit_required) && c.permit.required !== "unknown") {
    patch.permit_required = c.permit.required;
    if (c.permit.required === "yes" && empty(venue.permit_type)) patch.permit_type = c.permitType;
    if (empty(venue.permit_basis)) patch.permit_basis = `research: ${c.raw.source_url.trim() || "csv"}`;
    locks.push("permit");
  }
  const b = c.booking;
  const bookingBefore = Object.keys(patch).length;
  if (empty(venue.booking_method) && b.method !== "unknown") patch.booking_method = b.method;
  if (empty(venue.booking_url) && b.url) patch.booking_url = b.url;
  if (empty(venue.booking_phone) && b.phone) patch.booking_phone = b.phone;
  if (empty(venue.booking_basis) && b.basis && (b.url || b.phone || b.method !== "unknown")) patch.booking_basis = b.basis;
  if (Object.keys(patch).length > bookingBefore) locks.push("booking");

  if (empty(venue.website) && c.website) {
    patch.website = c.website;
    locks.push("website");
  }
  if (empty(venue.surface) && c.surface) {
    patch.surface = c.surface;
    locks.push("surface");
  }
  if (empty(venue.lit) && c.lit) {
    patch.lit = c.lit;
    locks.push("lit");
  }

  if (locks.length > 0) patch.locked_fields = mergeLocks(venue.locked_fields, locks);
  return patch;
}

/** Adds the notes block to a patch (or reports no change when the notes are already identical). */
export function withNotes(venue: Venue, patch: Record<string, unknown>, c: Clean): Record<string, unknown> {
  const next = mergeNotes(venue.player_notes as string | null, notesBlock(c));
  if (next === ((venue.player_notes as string | null) ?? "")) return patch;
  return { ...patch, player_notes: next };
}

/** A new, unverified, hand-added venue for a researched field no existing venue matches. */
export function newVenue(c: Clean, lat: number, lon: number, matchedAddress: string | null): Venue {
  const t = `${c.raw.venue_type} ${c.name}`.toLowerCase();
  const venue_type = /\b(school|college|university|academy)\b/.test(t) ? "school_unknown" : /\bclub\b|\bfc\b|\bprivate\b/.test(t) ? "club" : /\bpark\b/.test(t) ? "park" : "other";
  const locks = ["name", "lat", "lon", "setting", "address", "price", "permit", "booking", ...(c.surface ? ["surface"] : []), ...(c.lit ? ["lit"] : []), ...(c.website ? ["website"] : [])];
  const row: Venue = {
    venue_key: venueKeyFor(c.name, c.raw.address),
    state: c.state,
    name: c.name,
    lat,
    lon,
    venue_type,
    access: "unknown",
    field_count: c.fieldCount,
    surface: c.surface,
    lit: c.lit,
    address: [c.raw.address.trim(), c.raw.town.trim() && !c.raw.address.toLowerCase().includes(c.raw.town.trim().toLowerCase()) ? c.raw.town.trim() : "", c.state && !new RegExp(`\\b${c.state}\\b`).test(c.raw.address) ? c.state : ""].filter(Boolean).join(", ") || matchedAddress,
    operator: c.operator,
    website: c.website,
    sport_confidence: "research",
    priority: 1,
    setting: c.setting,
    price_status: c.price.status,
    price_text: c.price.text,
    price_min: c.price.min,
    price_max: c.price.max,
    price_unit: c.price.unit,
    // Never "manual": the app shows a manual price as Verified.
    price_source: "unknown",
    booking_method: c.booking.method,
    booking_url: c.booking.url,
    booking_phone: c.booking.phone,
    booking_basis: c.booking.basis,
    permit_required: c.permit.required,
    permit_type: c.permit.required === "yes" ? c.permitType : null,
    permit_basis: c.permit.required === "unknown" ? null : `research: ${c.raw.source_url.trim() || "csv"}`,
    verified: false,
    source: "manual",
    locked_fields: locks,
    player_notes: notesBlock(c),
  };
  return row;
}

/** Old and new values of the columns a patch changes, for the report. */
export function describeChange(venue: Venue, patch: Record<string, unknown>): string[] {
  return Object.keys(patch)
    .filter((k) => k !== "locked_fields")
    .map((k) => {
      const show = (v: unknown) => (v == null || v === "" ? "(empty)" : String(v).replace(/\s+/g, " ").slice(0, 70));
      return `${k}: ${show(venue[k])} -> ${show(patch[k])}`;
    });
}
