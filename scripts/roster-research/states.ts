/** US states, 2-letter codes, names and the AP-style abbreviations rosters use ("Conn.", "N.Y."). Pure. */

export const TARGET_STATES = ["CT", "NY", "NJ", "MA", "MD", "PA", "DC", "DE", "RI"] as const;
export type TargetState = (typeof TARGET_STATES)[number];
export const isTargetState = (s: string | null | undefined): s is TargetState => !!s && (TARGET_STATES as readonly string[]).includes(s);

const NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine",
  MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
  PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia",
  WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

/** AP abbreviations that are not just the code. */
const AP: Record<string, string> = {
  "ala": "AL", "ariz": "AZ", "ark": "AR", "calif": "CA", "colo": "CO", "conn": "CT", "del": "DE", "fla": "FL", "ill": "IL", "ind": "IN", "kan": "KS", "kans": "KS",
  "ky": "KY", "la": "LA", "mass": "MA", "md": "MD", "mich": "MI", "minn": "MN", "miss": "MS", "mo": "MO", "mont": "MT", "neb": "NE", "nev": "NV", "n h": "NH",
  "n j": "NJ", "n m": "NM", "n y": "NY", "n c": "NC", "n d": "ND", "okla": "OK", "ore": "OR", "pa": "PA", "penn": "PA", "r i": "RI", "s c": "SC", "s d": "SD",
  "tenn": "TN", "tex": "TX", "vt": "VT", "va": "VA", "wash": "WA", "w va": "WV", "wis": "WI", "wisc": "WI", "wyo": "WY", "d c": "DC",
};
const BY_NAME = new Map(Object.entries(NAMES).map(([code, n]) => [n, code]));

/**
 * "Conn." / "Connecticut" / "CT" / "N.Y." / "Washington, D.C." -> a 2-letter code, or null when it is not a US state
 * (a country, a province, nothing). A bare "Washington" is the state; "Washington, D.C." and "D.C." are DC.
 */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/ /g, " ").replace(/[,]/g, " ").trim().toLowerCase();
  if (!t) return null;
  if (/^(washington\s+)?(d\.?\s?c\.?|district of columbia)$/.test(t)) return "DC";
  const letters = t.replace(/[.\s]+/g, " ").trim();
  const upper = letters.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && NAMES[upper]) return upper;
  if (BY_NAME.has(letters)) return BY_NAME.get(letters)!;
  const key = letters.replace(/\s+$/, "");
  if (AP[key]) return AP[key]!;
  return null;
}
