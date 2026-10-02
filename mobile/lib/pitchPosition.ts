export type PitchSpot = "GK" | "CB" | "RB" | "LB" | "CDM" | "CM" | "CAM" | "RW" | "LW" | "ST";

export const PITCH_SPOTS: readonly PitchSpot[] = ["GK", "CB", "RB", "LB", "CDM", "CM", "CAM", "RW", "LW", "ST"];

/** Spot centers on a 68×105 vertical pitch, own goal at the bottom. */
export const PITCH_SPOT_XY: Record<PitchSpot, { x: number; y: number }> = {
  GK: { x: 34, y: 98 },
  CB: { x: 34, y: 85 },
  LB: { x: 11, y: 80 },
  RB: { x: 57, y: 80 },
  CDM: { x: 34, y: 70 },
  CM: { x: 34, y: 56 },
  CAM: { x: 34, y: 41 },
  LW: { x: 11, y: 30 },
  RW: { x: 57, y: 30 },
  ST: { x: 34, y: 18 },
};

export const PITCH_SPOT_NAME: Record<PitchSpot, string> = {
  GK: "Goalkeeper",
  CB: "Center back",
  RB: "Right back",
  LB: "Left back",
  CDM: "Defensive mid",
  CM: "Central mid",
  CAM: "Attacking mid",
  RW: "Right wing",
  LW: "Left wing",
  ST: "Striker",
};

const ALIASES: Record<string, PitchSpot> = {
  GK: "GK",
  GOALKEEPER: "GK",
  KEEPER: "GK",
  CB: "CB",
  "CENTER BACK": "CB",
  "CENTRE BACK": "CB",
  DEFENDER: "CB",
  SW: "CB",
  RB: "RB",
  RWB: "RB",
  "RIGHT BACK": "RB",
  LB: "LB",
  LWB: "LB",
  "LEFT BACK": "LB",
  CDM: "CDM",
  DM: "CDM",
  "DEFENSIVE MID": "CDM",
  CM: "CM",
  MID: "CM",
  MIDFIELDER: "CM",
  "CENTRAL MID": "CM",
  RM: "RW",
  LM: "LW",
  CAM: "CAM",
  AM: "CAM",
  "ATTACKING MID": "CAM",
  RW: "RW",
  "RIGHT WING": "RW",
  LW: "LW",
  "LEFT WING": "LW",
  ST: "ST",
  CF: "ST",
  STRIKER: "ST",
  FORWARD: "ST",
  ATTACKER: "ST",
};

function spotFor(value: string | null | undefined): PitchSpot | null {
  const key = (value ?? "").trim().toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  return key ? (ALIASES[key] ?? null) : null;
}

/**
 * The player's spot from `primary_position` (GK…ST), else the broad `playing_position`
 * (Goalkeeper → GK, Defender → CB, Midfielder → CM, Attacker → ST). Unknown values give null.
 */
export function primaryPitchSpot(primary: string | null | undefined, broad: string | null | undefined): PitchSpot | null {
  return spotFor(primary) ?? spotFor(broad);
}
