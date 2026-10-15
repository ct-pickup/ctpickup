import { normalizeState } from "./states.ts";

/**
 * A roster's "Hometown / High School" cell into city and state. The high school (everything after a "/") is dropped here and is
 * never kept. Returns state null when the hometown is not in the US (a country, a province) or cannot be read.
 */

export type Hometown = { city: string; state: string | null; kind: "us" | "foreign" | "unreadable"; messy: boolean };

const COUNTRY_HINT = /\b(canada|england|scotland|wales|ireland|germany|spain|france|italy|brazil|mexico|jamaica|nigeria|ghana|australia|japan|china|korea|sweden|norway|denmark|netherlands|poland|haiti|trinidad|bahamas|bermuda)\b/i;

export function cleanText(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHometown(rawIn: string): Hometown {
  const raw = cleanText(rawIn);
  // "City, State / High School" and "City, State / Previous School": keep only the part before the slash.
  const beforeSlash = raw.split(/\s\/\s|\/(?=\s*[A-Z])/)[0]!.trim();
  const base = beforeSlash.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const messy = beforeSlash !== raw || /[()\d]/.test(base) || base.length > 40;
  if (!base) return { city: "", state: null, kind: "unreadable", messy: true };

  // "Washington, D.C." is the city and the state; "D.C." alone too.
  if (/^(washington\s*,?\s*)?(d\.?\s?c\.?|district of columbia)$/i.test(base)) return { city: "Washington", state: "DC", kind: "us", messy };

  const parts = base.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    const st = normalizeState(last);
    if (st) return { city: parts.slice(0, -1).join(", "), state: st, kind: "us", messy };
    // "Toronto, Ontario, Canada" / "London, England"
    return { city: parts[0]!, state: null, kind: COUNTRY_HINT.test(base) || parts.length >= 2 ? "foreign" : "unreadable", messy };
  }
  // A lone word: maybe "Canada", maybe a city with no state. Never guess.
  return { city: base, state: null, kind: COUNTRY_HINT.test(base) ? "foreign" : "unreadable", messy: true };
}

/** "Fr." "So." "Jr." "Sr." "Gr." "R-Fr." "Redshirt Sophomore" -> FR SO JR SR GR R-FR R-SO; unknown text is kept upper-cased. */
export function normalizeClass(raw: string): string {
  const t = cleanText(raw).replace(/\./g, "").trim().toLowerCase();
  if (!t) return "";
  const red = /^(redshirt|rs|r)[-\s]+/.test(t);
  const core = t.replace(/^(redshirt|rs|r)[-\s]+/, "");
  const map: Record<string, string> = {
    fr: "FR", freshman: "FR", "1st": "FR", first: "FR", so: "SO", sophomore: "SO", "2nd": "SO", second: "SO", jr: "JR", junior: "JR", "3rd": "JR", third: "JR",
    sr: "SR", senior: "SR", "4th": "SR", fourth: "SR", gr: "GR", grad: "GR", graduate: "GR", "5th": "GR", fifth: "GR",
  };
  const c = map[core];
  if (c) return red ? `R-${c}` : c;
  return t.toUpperCase();
}
