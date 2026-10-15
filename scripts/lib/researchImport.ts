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

/** Party or package pricing is not what a team pays to rent a field. */
export const PACKAGE_PRICE = /\b(birthday|b-?day|party|parties|package|packages)\b/i;
/** Group, for-profit, commercial, organization and non-resident / outside-group tiers are not "the" price of the field. */
export const TIER_PRICE = /\b(group\s*[1-9]|for[- ]?profit|commercial|organi[sz]ations?|non[- ]?residents?|outside\s+groups?|outside\s+organi[sz]ations?)\b/i;

/**
 * Program and registration fees: per player / child / team, league, program, camp, clinic, class, registration, and "Res / Non-Res"
 * pricing. Those are what a person pays to join something, not what a team pays to rent the field.
 */
export const PROGRAM_PRICE = /\bper\s+(player|child|children|kid|kids|team|season)\b|\bregistration\b|\bleagues?\b|\bprograms?\b|\bcamps?\b|\bclinics?\b|\bclass(es)?\b|\bres\b.{0,25}\bnon[- ]?res\b/i;

const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, "; ").trim();

/**
 * When the price text is party / package pricing, or a group / commercial / non-resident tier table, it is kept in the notes and
 * the price stays unset: no status, no min / max, so the app shows "We're confirming" with no number.
 */
export function guardPrice(c: Clean): Clean {
  const text = c.raw.price_text.trim();
  const unit = c.raw.price_unit.trim();
  const both = `${text} ${unit}`;
  if (!text && !unit) return c;
  const reason = PACKAGE_PRICE.test(both)
    ? "party or package pricing, not used as a rental price"
    : PROGRAM_PRICE.test(both)
      ? "program, league or registration fees, not used as a rental price"
      : TIER_PRICE.test(both)
        ? "group / commercial / non-resident tiers, not used as the field's price"
        : null;
  if (!reason) return c;
  const shown = [oneLine(text), unit && !text.toLowerCase().includes(unit.toLowerCase()) ? `(unit: ${unit})` : ""].filter(Boolean).join(" ");
  return {
    ...c,
    price: { status: "unknown", text: null, min: null, max: null, unit: null },
    priceGuarded: true,
    extraNotes: [`Price text (${reason}): ${shown}`, ...c.extraNotes],
    raw: { ...c.raw, price_text: "" },
  };
}

export function cleanRow(raw: ResearchRaw, fileState: string | null): Clean {
  const addrState = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(raw.address)?.[1] ?? null;
  const state = fileState ?? addrState;
  const setting = /^indoor/i.test(raw.setting) ? "indoor" : /^(both|mixed|indoor\s*\+|indoor and outdoor)/i.test(raw.setting) ? "both" : "outdoor";
  const lit = triState(raw.lit);
  const fc = Number.parseInt(raw.field_count, 10);
  const base: Clean = {
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
  return guardPrice(base);
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

/** A facility row as a Clean row, so matching, filling, locking and notes work exactly as for the outdoor schema. */
export function cleanFacilityRow(f: FacilityRaw, fileState: string | null): Clean {
  const asOutdoor = {
    name: f.name, venue_type: "", operator: f.operator_or_chain, town: f.town, county: f.county, address: f.address, setting: f.setting,
    surface: f.surface, field_count: f.field_count, lit: "", free_or_paid: "", price_text: f.price_text, price_unit: f.price_unit,
    permit_required: "", permit_issuer: "", how_to_book: "", booking_url: f.booking_url, contact_email: f.email, contact_phone: f.phone,
    residency_rule: "", availability_notes: "", source_url: f.source_url, source_date: f.source_date, confidence: f.confidence,
  } as ResearchRaw;
  const c = cleanRow(asOutdoor, fileState);
  const members = triState(f.membership_required) === "yes";
  const url = /^https?:\/\//i.test(f.booking_url.trim()) ? f.booking_url.trim() : null;
  const phone = f.phone.trim() || null;
  const extra: string[] = [...c.extraNotes];
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
    price: c.price,
    priceGuarded: c.priceGuarded,
    extraNotes: extra,
    raw: { ...asOutdoor, price_text: c.priceGuarded ? "" : oneLine(f.price_text) },
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

/** Lower-case words with diacritics, punctuation and "&" / "and" removed (Muñoz = Munoz). Filler words are still in. */
export function rawTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Extra words that never identify a place on their own (on top of STOP): common to many fields and campuses. */
const MATCH_STOP = new Set(["new", "town", "hall", "park", "field", "fields", "school", "high", "middle", "elementary", "academy", "athletic", "soccer", "complex", "center", "memorial", "veterans", "main", "north", "south", "east", "west", "upper", "lower", "stadium", "turf", "grass"]);

/** A word that can be evidence of the same place: letters only, 4 or more of them, and not a common word. Never a numeral. */
export function isMatchWord(w: string): boolean {
  return /^[a-z]{4,}$/.test(w) && !STOP.has(w) && !MATCH_STOP.has(w);
}

/** "Chelsea Piers · Noroton" -> "Chelsea Piers"; "Jennings School (1)" -> "Jennings School". */
export function cleanVenueName(name: string): string {
  return name.replace(/\s*[·•|]\s*.*$/, "").replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
}

/** Where the research row is: its own town, county and state words are not evidence that two names are the same place. */
export type NameCtx = { town?: string | null; county?: string | null; state?: string | null };

const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine",
  MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
  PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia",
  WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

function placeWords(ctx: NameCtx | undefined): Set<string> {
  const out = new Set<string>();
  if (!ctx) return out;
  for (const w of rawTokens(ctx.town ?? "")) out.add(w);
  for (const w of rawTokens(ctx.county ?? "")) if (w !== "county") out.add(w);
  const st = (ctx.state ?? "").trim().toUpperCase();
  if (st) {
    out.add(st.toLowerCase());
    for (const w of rawTokens(STATE_NAMES[st] ?? "")) out.add(w);
  }
  return out;
}

/** The words of a name that count as evidence: suffixes cleaned, the row's own place words removed, then isMatchWord. */
export function meaningfulTokens(name: string, ctx?: NameCtx): string[] {
  const place = placeWords(ctx);
  return [...new Set(rawTokens(cleanVenueName(name)).filter((w) => !place.has(w)).filter(isMatchWord))];
}

export function nameTokens(name: string): string[] {
  const t = rawTokens(name);
  const kept = t.filter((w) => !STOP.has(w));
  return kept.length > 0 ? kept : t;
}

const LEVEL_OF: Record<string, string> = { elementary: "elementary", middle: "middle", junior: "middle", high: "high", academy: "academy", college: "college", university: "college" };

/** The school levels a name mentions (junior high counts as middle). Empty when it names none. */
export function schoolLevels(name: string): Set<string> {
  const t = rawTokens(cleanVenueName(name)).join(" ").replace(/\bjunior high\b/g, "middle");
  return new Set(t.split(" ").map((w) => LEVEL_OF[w]).filter((x): x is string => !!x));
}

/** Both names say what kind of school they are, and it is not the same kind: different places, whatever else they share. */
export function levelsConflict(a: string, b: string): boolean {
  const la = schoolLevels(a);
  const lb = schoolLevels(b);
  if (la.size === 0 || lb.size === 0) return false;
  return la.size !== lb.size || [...la].some((x) => !lb.has(x));
}

/** Names that are close enough to be one place when the two are within a few hundred meters. */
export function namesSimilar(a: string, b: string): boolean {
  if (levelsConflict(a, b)) return false;
  const ta = new Set(meaningfulTokens(a));
  const tb = new Set(meaningfulTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = [...ta].filter((w) => tb.has(w)).length;
  if (shared === 0) return false;
  if (shared === ta.size || shared === tb.size) return true;
  return shared / (ta.size + tb.size - shared) >= 0.5;
}

function sameWords(ta: string[], tb: string[]): boolean {
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length === tb.length && ta.every((w) => tb.includes(w))) return true;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.length >= 2 && small.every((w) => big.includes(w));
}

/**
 * The same place by normalized name: identical meaningful words, or one name's meaningful words are all in the other (the shorter
 * one needs at least 2). Meaningful = letters only, 4+ letters, not a common word. If both names say what kind of school they are
 * and the kinds differ, never. The row's own town, county and state words are also tried with removed ("Chelsea Piers Connecticut"
 * = "Chelsea Piers · Noroton"), which can only add matches.
 */
export function namesSameVenue(a: string, b: string, ctx?: NameCtx): boolean {
  if (levelsConflict(a, b)) return false;
  if (sameWords(meaningfulTokens(a), meaningfulTokens(b))) return true;
  return ctx ? sameWords(meaningfulTokens(a, ctx), meaningfulTokens(b, ctx)) : false;
}

export const SAME_NAME_M = 1500;
export const SCHOOL_NAME_M = 400;
/** A name that says it is a school (the plain-word filter drops "school", so check the raw name). */
export const isSchoolName = (name: string): boolean => /\b(school|high|middle|elementary|academy|college|university)\b/i.test(name);

export type Match = { venue: Venue; meters: number; reason: "near + similar name" | "same venue name" | "very near" };

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
    // A cell is 0.01 degrees: about 1113 m tall and 1113 * cos(lat) m wide. Look far enough out to cover the radius.
    const ringsLat = Math.max(1, Math.ceil(meters / 1113));
    const ringsLon = Math.max(1, Math.ceil(meters / (1113 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05))));
    const cy = Math.floor(lat * 100);
    const cx = Math.floor(lon * 100);
    for (let dy = -ringsLat; dy <= ringsLat; dy++)
      for (let dx = -ringsLon; dx <= ringsLon; dx++) {
        for (const v of this.cells.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const m = metersBetween(lat, lon, v.lat!, v.lon!);
          if (m <= meters) out.push({ venue: v, meters: m });
        }
      }
    return out.sort((a, b) => a.meters - b.meters);
  }
}

/**
 * The venue this researched field is, or null. A name match beats a mere closeness match:
 *   - similar name within 150 m (400 m for a school-named row)
 *   - the same venue name (normalized, min 2 meaningful words unless identical) within 1.5 km
 *   - any name within 40 m
 */
export function findMatch(name: string, lat: number, lon: number, index: VenueIndex, ctx?: NameCtx): Match | null {
  const similarM = isSchoolName(name) ? SCHOOL_NAME_M : NEAR_WITH_NAME_M;
  // A different kind of school is a different place, whatever else matches.
  const near = index.near(lat, lon, SAME_NAME_M).filter((n) => !levelsConflict(name, n.venue.name));
  const similar = near.find((n) => n.meters <= similarM && namesSimilar(name, n.venue.name));
  if (similar) return { ...similar, reason: "near + similar name" };
  const same = near.find((n) => namesSameVenue(name, n.venue.name, ctx));
  if (same) return { ...same, reason: "same venue name" };
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

function rowLines(c: Clean): string[] {
  const r = c.raw;
  const lines: string[] = [];
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
  return lines;
}

/** The admin-only notes block for one row: where the numbers came from and the things the app has no column for. */
export function notesBlock(c: Clean): string {
  return [START, ...rowLines(c), END].join("\n");
}

export const CAMPUS_NOTE = "multiple fields on this campus";

/** One block for every research row that matched a venue (names, sources, residency, availability), not just the last. */
export function notesBlockGroup(cs: Clean[], disagreements: string[] = [], attached: Clean[] = []): string {
  if (cs.length === 1 && disagreements.length === 0 && attached.length === 0) return notesBlock(cs[0]!);
  const lines = [START, `${cs.length} research rows matched this venue${attached.length ? `, ${attached.length} of them nearby rows attached for contact and booking only` : ""}.`];
  if (disagreements.length) lines.push(`${CAMPUS_NOTE} (rows differ on: ${disagreements.join(", ")}; those were left empty)`);
  for (const c of cs) lines.push(`-- ${c.name}${attached.includes(c) ? " (nearby, attached; not an exact match)" : ""} --`, ...rowLines(c));
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

/** The one value all candidates share. conflict = they disagree (then nothing should be filled). */
function agreed<T>(cands: { key: string; value: T }[]): { value: T | null; conflict: boolean } {
  if (cands.length === 0) return { value: null, conflict: false };
  const first = cands[0]!;
  return cands.every((c) => c.key === first.key) ? { value: first.value, conflict: false } : { value: null, conflict: true };
}

/**
 * The columns to change on an existing venue from every research row that matched it. A column is filled only when it is empty
 * or unknown today, the research has a real value, and every matching row that has an opinion agrees. If they disagree the column
 * stays empty and the attribute is returned in `disagreements` (the notes then say "multiple fields on this campus"). Never the
 * name, never price_source, never verified. patch is {} when there is nothing new.
 */
export function fillPatchGroup(venue: Venue, cs: Clean[]): { patch: Record<string, unknown>; disagreements: string[] } {
  const patch: Record<string, unknown> = {};
  const locks: string[] = [];
  const disagreements: string[] = [];
  const note = (name: string, conflict: boolean) => {
    if (conflict) disagreements.push(name);
  };

  if (empty(venue.price_status)) {
    const g = agreed(cs.filter((c) => c.price.status !== "unknown").map((c) => ({ key: `${c.price.status}|${c.price.min}|${c.price.max}|${c.price.unit}`, value: c.price })));
    note("price", g.conflict);
    if (g.value) {
      patch.price_status = g.value.status;
      if (g.value.text) patch.price_text = g.value.text;
      if (g.value.min != null) patch.price_min = g.value.min;
      if (g.value.max != null) patch.price_max = g.value.max;
      if (g.value.unit) patch.price_unit = g.value.unit;
      locks.push("price");
    }
  }
  if (empty(venue.permit_required)) {
    const g = agreed(cs.filter((c) => c.permit.required !== "unknown").map((c) => ({ key: `${c.permit.required}|${c.permitType}`, value: c })));
    note("permit", g.conflict);
    if (g.value) {
      patch.permit_required = g.value.permit.required;
      if (g.value.permit.required === "yes" && empty(venue.permit_type)) patch.permit_type = g.value.permitType;
      if (empty(venue.permit_basis)) patch.permit_basis = `research: ${g.value.raw.source_url.trim() || "csv"}`;
      locks.push("permit");
    }
  }
  {
    const wantsBooking = empty(venue.booking_method) || empty(venue.booking_url) || empty(venue.booking_phone) || empty(venue.booking_basis);
    const g = agreed(cs.filter((c) => c.booking.method !== "unknown" || c.booking.url || c.booking.phone).map((c) => ({ key: `${c.booking.method}|${c.booking.url}|${c.booking.phone}`, value: c.booking })));
    if (wantsBooking) note("booking", g.conflict);
    const b = g.value;
    if (b && wantsBooking) {
      const before = Object.keys(patch).length;
      if (empty(venue.booking_method) && b.method !== "unknown") patch.booking_method = b.method;
      if (empty(venue.booking_url) && b.url) patch.booking_url = b.url;
      if (empty(venue.booking_phone) && b.phone) patch.booking_phone = b.phone;
      if (empty(venue.booking_basis) && b.basis && (b.url || b.phone || b.method !== "unknown")) patch.booking_basis = b.basis;
      if (Object.keys(patch).length > before) locks.push("booking");
    }
  }
  const simple = (attr: "website" | "surface" | "lit", get: (c: Clean) => string | null) => {
    if (!empty(venue[attr])) return;
    const g = agreed(cs.map((c) => get(c)).filter((v): v is string => !!v).map((v) => ({ key: v, value: v })));
    note(attr, g.conflict);
    if (g.value) {
      patch[attr] = g.value;
      locks.push(attr);
    }
  };
  simple("website", (c) => c.website);
  simple("surface", (c) => c.surface);
  simple("lit", (c) => c.lit);

  if (locks.length > 0) patch.locked_fields = mergeLocks(venue.locked_fields, locks);
  return { patch, disagreements };
}

/**
 * Attach-only: what a nearby row may add to an existing venue it is not an exact match for. Booking (method, link, phone, basis)
 * and website only, and only where empty. Never price, permit, surface, lit, or anything else.
 */
export function attachPatch(venue: Venue, cs: Clean[]): { patch: Record<string, unknown>; disagreements: string[] } {
  const full = fillPatchGroup(venue, cs);
  const allowed = new Set(["booking_method", "booking_url", "booking_phone", "booking_basis", "website"]);
  const patch: Record<string, unknown> = {};
  const locks: string[] = [];
  for (const [k, v] of Object.entries(full.patch)) if (allowed.has(k)) patch[k] = v;
  if (Object.keys(patch).some((k) => k.startsWith("booking_"))) locks.push("booking");
  if ("website" in patch) locks.push("website");
  if (locks.length) patch.locked_fields = mergeLocks(venue.locked_fields, locks);
  return { patch, disagreements: full.disagreements.filter((d) => d === "booking" || d === "website") };
}

/** One row: the same rules as a group of one. */
export function fillPatch(venue: Venue, c: Clean): Record<string, unknown> {
  return fillPatchGroup(venue, [c]).patch;
}

/** Adds the notes block to a patch (or reports no change when the notes are already identical). */
export function withNotesGroup(venue: Venue, patch: Record<string, unknown>, cs: Clean[], disagreements: string[] = [], attached: Clean[] = []): Record<string, unknown> {
  const next = mergeNotes(venue.player_notes as string | null, notesBlockGroup(cs, disagreements, attached));
  if (next === ((venue.player_notes as string | null) ?? "")) return patch;
  return { ...patch, player_notes: next };
}

export function withNotes(venue: Venue, patch: Record<string, unknown>, c: Clean): Record<string, unknown> {
  return withNotesGroup(venue, patch, [c]);
}

export function inferVenueType(c: Clean): string {
  const t = `${c.raw.venue_type} ${c.name}`.toLowerCase();
  return /\b(school|college|university|academy)\b/.test(t) ? "school_unknown" : /\bclub\b|\bfc\b|\bprivate\b/.test(t) ? "club" : /\bpark\b/.test(t) ? "park" : "other";
}

/** A new, unverified, hand-added venue for a researched field no existing venue matches. */
export function newVenue(c: Clean, lat: number, lon: number, matchedAddress: string | null): Venue {
  const venue_type = inferVenueType(c);
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

// ---------------------------------------------------------------------------
// Duplicate prevention for new venues, and the whole plan
// ---------------------------------------------------------------------------

export const DUPLICATE_NEAR_M = 300;
export const DUPLICATE_SCHOOL_M = 800;

export type Near = { venue: Venue; meters: number };

/** The closest existing venue within maxM, or null. */
export function nearestVenue(index: VenueIndex, lat: number, lon: number, maxM = 2000): Near | null {
  // The grid looks one 0.01-degree cell around (about 1 km), so wider searches use more rings.
  return index.near(lat, lon, maxM)[0] ?? null;
}

export function isSchoolRow(c: Clean): boolean {
  return /\b(school|college|university|academy|high|middle|elementary)\b/i.test(`${c.raw.venue_type} ${c.name}`);
}

/**
 * A new venue is a possible duplicate when an existing venue is within 300 m of its point, or (for a school) an existing venue's
 * school_name matches the research school name within 800 m. Returns the nearest such venue.
 */
export function possibleDuplicate(c: Clean, lat: number, lon: number, index: VenueIndex): { near: Near; why: string } | null {
  const close = index.near(lat, lon, DUPLICATE_NEAR_M)[0];
  if (close) return { near: close, why: `existing venue within ${DUPLICATE_NEAR_M} m` };
  if (isSchoolRow(c)) {
    const sameSchool = index.near(lat, lon, DUPLICATE_SCHOOL_M).find((n) => typeof n.venue.school_name === "string" && n.venue.school_name.trim() !== "" && namesSimilar(c.name, n.venue.school_name as string));
    if (sameSchool) return { near: sameSchool, why: `same school within ${DUPLICATE_SCHOOL_M} m` };
  }
  return null;
}

export const ATTACH_NEAR_M = 400;

export type Geo = { lat: number; lon: number; matched: string };
export type Item = { file: string; line: number; c: Clean; geo: Geo | null };
export type Update = { venue: Venue; items: Item[]; attached: Item[]; matches: Match[]; patch: Record<string, unknown>; disagreements: string[] };
export type Insert = { item: Item; venue: Venue; nearest: Near | null; /** Looked like a duplicate but was inserted because --include-possible-duplicates was set. */ flaggedDuplicate: boolean };
export type Plan = {
  noGeo: Item[];
  updates: Update[];
  inserts: Insert[];
  duplicates: { item: Item; near: Near; why: string }[];
  /** Held-back duplicates merged into the nearest existing venue as attach-only (booking, website, notes). */
  attached: { item: Item; near: Near; why: string }[];
  repeats: { item: Item; of: string }[];
};

export const nameCtx = (c: Clean): NameCtx => ({ town: c.raw.town, county: c.raw.county, state: c.state });

/** The words (letters, 4+, not common, not the row's own town / county / state) a row's name shares with an existing venue. */
export function attachShared(c: Clean, v: Venue): string[] {
  if (levelsConflict(c.name, v.name)) return [];
  if (typeof v.school_name === "string" && v.school_name.trim() && levelsConflict(c.name, v.school_name)) return [];
  const ctx = nameCtx(c);
  const mine = meaningfulTokens(c.name, ctx);
  const theirs = new Set([...meaningfulTokens(v.name, ctx), ...meaningfulTokens(typeof v.school_name === "string" ? v.school_name : "", ctx)]);
  return mine.filter((w) => theirs.has(w));
}

/** Does the existing venue plausibly be this row's place? A shared meaningful name word, or the same town and venue type. */
export function attachReason(c: Clean, v: Venue): string | null {
  if (levelsConflict(c.name, v.name)) return null;
  const shared = attachShared(c, v);
  if (shared.length > 0) return `shares ${shared.map((w) => `"${w}"`).join(", ")} in the name`;
  const town = c.raw.town.trim().toLowerCase();
  const address = typeof v.address === "string" ? v.address.toLowerCase() : "";
  if (town && address.includes(town) && v.venue_type && v.venue_type === inferVenueType(c)) return `same town (${c.raw.town.trim()}) and venue type`;
  return null;
}

/**
 * Decides what to do with every row. Matching is against the venues that exist today; rows that match the same venue are handled
 * together (see fillPatchGroup). Rows that match nothing become new venues unless they look like a duplicate of an existing one:
 * those within 400 m that share a name word (or town and type) with it are attached to it (booking, website and notes only), the
 * rest are held back unless includeDuplicates. A row that repeats another new row is ignored.
 */
export function planImport(items: Item[], venues: Venue[], opts: { includeDuplicates?: boolean } = {}): Plan {
  const index = new VenueIndex();
  for (const v of venues) index.add(v);
  const plan: Plan = { noGeo: [], updates: [], inserts: [], duplicates: [], attached: [], repeats: [] };
  const groups = new Map<string, { venue: Venue; items: Item[]; attached: Item[]; matches: Match[] }>();
  const group = (v: Venue) => {
    const g = groups.get(v.venue_key) ?? { venue: v, items: [], attached: [], matches: [] };
    groups.set(v.venue_key, g);
    return g;
  };
  const newIndex = new VenueIndex();
  const newKeys = new Set<string>();

  for (const item of items) {
    const { c, geo } = item;
    if (!geo) {
      plan.noGeo.push(item);
      continue;
    }
    const m = findMatch(c.name, geo.lat, geo.lon, index, nameCtx(c));
    if (m) {
      const g = group(m.venue);
      g.items.push(item);
      g.matches.push(m);
      continue;
    }
    const row = newVenue(c, Number(geo.lat.toFixed(6)), Number(geo.lon.toFixed(6)), geo.matched);
    const again = newKeys.has(row.venue_key) ? row.venue_key : findMatch(c.name, geo.lat, geo.lon, newIndex, nameCtx(c))?.venue.venue_key;
    if (again) {
      plan.repeats.push({ item, of: again });
      continue;
    }
    const dup = possibleDuplicate(c, geo.lat, geo.lon, index);
    if (dup && !opts.includeDuplicates) {
      const target = index.near(geo.lat, geo.lon, ATTACH_NEAR_M).map((n) => ({ n, why: attachReason(c, n.venue) })).find((x) => x.why);
      if (target) {
        group(target.n.venue).attached.push(item);
        plan.attached.push({ item, near: target.n, why: target.why! });
      } else plan.duplicates.push({ item, near: dup.near, why: dup.why });
      continue;
    }
    newKeys.add(row.venue_key);
    newIndex.add(row);
    plan.inserts.push({ item, venue: row, nearest: dup?.near ?? nearestVenue(index, geo.lat, geo.lon), flaggedDuplicate: !!dup });
  }

  for (const g of groups.values()) {
    const matched = g.items.map((i) => i.c);
    const attachedC = g.attached.map((i) => i.c);
    const main = fillPatchGroup(g.venue, matched);
    const view: Venue = { ...g.venue, ...main.patch };
    const extra = attachedC.length ? attachPatch(view, attachedC) : { patch: {}, disagreements: [] as string[] };
    const patch: Record<string, unknown> = { ...main.patch, ...extra.patch };
    const disagreements = [...new Set([...main.disagreements, ...extra.disagreements])];
    plan.updates.push({ ...g, patch: withNotesGroup(g.venue, patch, [...matched, ...attachedC], disagreements, attachedC), disagreements });
  }
  return plan;
}
