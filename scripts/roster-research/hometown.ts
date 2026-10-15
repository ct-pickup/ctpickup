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

const COUNTRY_TAIL = /[\s,]*[(\[]?\s*(?:u\.?\s?s\.?\s?a\.?|u\.?\s?s\.?|united states(?: of america)?)\s*[)\]]?\s*$/i;

/** One chunk at a time: "Newark" + "N.J." -> city Newark, state NJ. Used when the pieces are not comma separated. */
function splitTrailingState(base: string): { city: string; state: string } | null {
  // "Brooklyn N.Y." / "Stamford CT" / "Newark New Jersey": a state written as the last 1 to 3 words.
  const words = base.split(/\s+/);
  for (const n of [3, 2, 1]) {
    if (words.length <= n) continue;
    const tail = words.slice(-n).join(" ");
    const abbreviated = /\.$/.test(tail) || /^[A-Z]{2}$/.test(tail) || /^(?:[A-Za-z]\.\s?){2,3}$/.test(tail);
    const st = normalizeState(tail);
    if (st && (abbreviated || n >= 2 || tail.length > 2)) {
      // A bare capitalised word that happens to be a state name is fine ("Newark New Jersey"); a lone lower-case 2-letter word is not.
      if (n === 1 && !abbreviated && tail.length <= 2) continue;
      return { city: words.slice(0, -n).join(" "), state: st };
    }
  }
  return null;
}

export function parseHometown(rawIn: string): Hometown {
  const raw = cleanText(rawIn);
  // "City, State / High School" (with or without spaces around the slash): keep only the part before it.
  const beforeSlash = raw.split(/\s*\/\s*/)[0]!.trim();
  let base = beforeSlash
    .replace(/\s*[([][^)\]]*[)\]]/g, " ") // "(Poly Prep)" and "[x]" anywhere
    .replace(COUNTRY_TAIL, "") // ", USA"
    .replace(/[\s,]+\d{5}(?:-\d{4})?\b/g, "") // zip codes
    .replace(/[\s,;:\-\u2013\u2014]+$/g, "") // trailing punctuation
    .replace(/\s+/g, " ")
    .trim();
  base = base.replace(COUNTRY_TAIL, "").replace(/[\s,;:\-]+$/g, "").trim();
  const messy = beforeSlash !== raw || base !== beforeSlash || /\d/.test(base) || base.length > 40;
  if (!base) return { city: "", state: null, kind: "unreadable", messy: true };

  // Every way of writing Washington, D.C. ("Wash., D.C.", "Washington DC", "D.C.").
  if (/^(?:(?:wash(?:ington|\.)?)[\s,]*)?(?:d\.?\s?c\.?|district of columbia)$/i.test(base)) return { city: "Washington", state: "DC", kind: "us", messy };

  const parts = base.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    const st = normalizeState(last);
    if (st) {
      const city = parts.slice(0, -1).join(", ");
      return { city: st === "DC" && /^wash(?:ington|\.)?$/i.test(city) ? "Washington" : city, state: st, kind: "us", messy };
    }
    // "Boston, Mass., Boston Latin" style leftovers: a state in the second-to-last part.
    const prev = normalizeState(parts[parts.length - 2]);
    if (prev && parts.length >= 3) return { city: parts.slice(0, -2).join(", "), state: prev, kind: "us", messy: true };
    // "Brooklyn, NY Poly Prep": the state is the first word of the last part.
    const firstWord = last.split(/\s+/)[0]!;
    const lead = normalizeState(firstWord);
    if (lead && last.split(/\s+/).length > 1 && (/^[A-Z]{2}$/.test(firstWord) || /\.$/.test(firstWord))) return { city: parts.slice(0, -1).join(", "), state: lead, kind: "us", messy: true };
    // "Toronto, Ontario" / "London, England"
    return { city: parts[0]!, state: null, kind: "foreign", messy };
  }
  const spaced = splitTrailingState(base);
  if (spaced) return { city: spaced.city, state: spaced.state, kind: "us", messy: true };
  // "NYC" alone, or a lone word: maybe "Canada", maybe a city with no state. Never guess.
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
