/** Pure helpers for scripts/import-ct-venues.ts. No network, no env, no secrets in here. */

export const VENUE_COLUMNS = [
  "venue_key", "state", "name", "lat", "lon", "venue_type", "school_key", "school_name", "school_kind", "access", "access_basis",
  "field_count", "turf_count", "surface", "lit", "address", "website", "operator", "sport_confidence", "osm_ids", "priority",
  "price_status", "price_text", "price_min", "price_max", "price_unit", "price_source",
  "booking_method", "booking_url", "booking_phone", "booking_basis",
  "permit_required", "permit_type", "permit_basis",
  "verified", "last_verified_at", "updated_at", "setting",
] as const;

export const SCHOOL_COLUMNS = [
  "school_key", "state", "name", "kind", "kind_basis", "amenity", "lat", "lon", "website", "phone", "address", "has_field_mapped",
] as const;

const NUMERIC = new Set(["lat", "lon", "price_min", "price_max"]);
const INTEGER = new Set(["field_count", "turf_count", "priority"]);
const BOOLEAN = new Set(["verified", "has_field_mapped"]);

/** Values the database check constraints accept. A bad value would fail a whole batch, so we check first. */
const ALLOWED: Record<string, readonly string[]> = {
  price_status: ["free", "paid", "unknown"],
  price_source: ["osm", "manual", "unknown"],
  booking_method: ["online", "phone", "permit_request", "unknown"],
  permit_required: ["yes", "no", "unknown"],
  setting: ["outdoor", "indoor", "both"],
};

/** Where a venue is. A missing or blank value means outdoor, the database default. */
export const DEFAULT_SETTING = "outdoor";

export function toBoolean(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "t" || s === "yes") return true;
    if (s === "false" || s === "f" || s === "no") return false;
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  return s === "" ? null : s;
}

/** `skipped: "unnamed"` means the row is fine except it has no name (the database requires one). Not an error. */
export type NormalizeResult = { row: Record<string, unknown> | null; problems: string[]; droppedKeys: string[]; skipped?: "unnamed" };
export type NormalizeOptions = { unnamedAs?: string | null };

function normalize(raw: unknown, columns: readonly string[], keyColumn: string, opts: NormalizeOptions): NormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { row: null, problems: ["row is not an object"], droppedKeys: [] };
  const src = raw as Record<string, unknown>;
  const known = new Set<string>(columns);
  const droppedKeys = Object.keys(src).filter((k) => !known.has(k));
  const row: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const col of columns) {
    if (!(col in src)) continue;
    const v = src[col];
    if (BOOLEAN.has(col)) {
      const b = toBoolean(v);
      // A missing verified flag means not verified. Never guess true.
      row[col] = b ?? false;
      if (b === null && v !== null && v !== undefined && v !== "") problems.push(`${col}: cannot read ${JSON.stringify(v)} as a boolean`);
    } else if (NUMERIC.has(col)) {
      const n = toNumber(v);
      row[col] = n;
      if (n === null && v !== null && v !== undefined && v !== "") problems.push(`${col}: not a number`);
    } else if (INTEGER.has(col)) {
      const n = toNumber(v);
      row[col] = n === null ? null : Math.trunc(n);
      if (n === null && v !== null && v !== undefined && v !== "") problems.push(`${col}: not a number`);
    } else if (col === "setting") {
      // Case-insensitive; anything that is not outdoor / indoor / both is rejected below.
      row[col] = toText(v)?.toLowerCase() ?? DEFAULT_SETTING;
    } else {
      row[col] = toText(v);
    }
  }
  if (columns.includes("setting") && !("setting" in row)) row.setting = DEFAULT_SETTING;
  if (!row[keyColumn]) problems.push(`${keyColumn} is missing`);
  let unnamed = false;
  if (!row.name) {
    if (opts.unnamedAs) row.name = opts.unnamedAs;
    else unnamed = true;
  }
  for (const [col, allowed] of Object.entries(ALLOWED)) {
    const v = row[col];
    if (v != null && !allowed.includes(String(v))) problems.push(`${col}: "${String(v)}" is not one of ${allowed.join(" | ")}`);
  }
  if (problems.length) return { row: null, problems, droppedKeys };
  if (unnamed) return { row: null, problems: [], droppedKeys, skipped: "unnamed" };
  return { row, problems, droppedKeys };
}

export const normalizeVenue = (raw: unknown, opts: NormalizeOptions = {}): NormalizeResult => normalize(raw, VENUE_COLUMNS, "venue_key", opts);
export const normalizeSchool = (raw: unknown, opts: NormalizeOptions = {}): NormalizeResult => normalize(raw, SCHOOL_COLUMNS, "school_key", opts);

/** Accepts a bare array, or an object wrapping one under venues / schools / rows / data / items. */
export function extractRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const k of ["venues", "schools", "rows", "data", "items"]) {
      const v = (json as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  throw new Error("Expected a JSON array of rows (or an object holding one under venues / schools / rows / data / items).");
}

export type TargetCheck = { ok: true; host: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/**
 * Decides whether the import may run against `urlStr`.
 *  - Looks like production (host has prod / production / live as a word, or is listed in `prodHosts`): refuse unless allowProd.
 *  - A local database is fine.
 *  - Any other remote host: a Supabase URL does not say dev or prod, so the caller must repeat the host with --expect-host.
 */
export function checkTarget(urlStr: string, opts: { allowProd: boolean; expectHost: string | null; prodHosts: string[] }): TargetCheck {
  let host: string;
  try {
    host = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "The database URL is not a valid URL." };
  }
  const listedProd = opts.prodHosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
  const namedProd = /(^|[.-])(prod|production|live)([.-]|$)/.test(host);
  if ((listedProd || namedProd) && !opts.allowProd) {
    return { ok: false, reason: `${host} looks like production. Refusing. Pass --allow-prod only if you really mean it.` };
  }
  if (LOCAL_HOSTS.has(host)) return { ok: true, host };
  if (!opts.expectHost || opts.expectHost.trim().toLowerCase() !== host) {
    return { ok: false, reason: `I can't tell whether ${host} is dev or production. Re-run with --expect-host ${host} to confirm it is the database you mean.` };
  }
  return { ok: true, host };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Strips a secret from any text before it can be printed. */
export function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}
