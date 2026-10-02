import * as zipcodes from "zipcodes";

const BROAD_POSITION_ABBR: Record<string, string> = {
  Goalkeeper: "GK",
  Defender: "DEF",
  Midfielder: "MID",
  Attacker: "ATT",
};

/** "CB" from primary_position, else a short form of the broad playing_position. */
export function positionAbbreviation(primary: string | null | undefined, broad: string | null | undefined): string | null {
  const p = (primary ?? "").trim();
  if (p) return p;
  const b = (broad ?? "").trim();
  if (!b) return null;
  return BROAD_POSITION_ABBR[b] ?? b;
}

/** Town name for a 5-digit ZIP, e.g. "06880" -> "Westport". */
export function townFromZip(zip: string | null | undefined): string | null {
  const digits = String(zip ?? "").replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return null;
  try {
    const city = zipcodes.lookup(digits)?.city?.trim();
    return city || null;
  } catch {
    return null;
  }
}

/** "CB · Westport", or whichever half is known. */
export function positionTownLine(position: string | null, town: string | null): string | null {
  const parts = [position, town].filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(" · ") : null;
}
