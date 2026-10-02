/**
 * Player-to-game compatibility. Server-only: the score, the weights and the
 * component values must never reach a client. Routes return reasons only.
 */

export const COMPATIBILITY_WEIGHTS = {
  level: 0.4,
  position: 0.2,
  distance: 0.2,
  playedWith: 0.1,
  usualTime: 0.1,
} as const;

export type CompatibilityComponent = keyof typeof COMPATIBILITY_WEIGHTS;

/** Minimum component value (0..1) for a component to be offered as a reason. */
export const REASON_THRESHOLDS: Record<CompatibilityComponent, number> = {
  level: 0.75,
  position: 0.5,
  distance: 0.5,
  playedWith: 1 / 3,
  usualTime: 0.4,
};

export const MAX_REASONS = 2;

/** Level fit when the game level or the player's level is unknown. */
export const NEUTRAL_LEVEL_FIT = 0.5;

/** Played-with saturates at this many attendees. */
export const PLAYED_WITH_SATURATION = 3;

/** Usual time needs at least this many past attended games to say anything. */
export const USUAL_TIME_MIN_HISTORY = 2;

/** Usual time = exact * share of past games on the same ET weekday and bucket + bucket * share in the same bucket on any day. */
export const USUAL_TIME_BLEND = { exact: 0.75, bucket: 0.25 } as const;

/** Internal level stand-in when `player_ratings.star_rating` is missing. Never shown to players. */
export const TIER_STAR_FALLBACK: Record<string, number> = {
  bronze: 1.0,
  silver: 2.0,
  gold: 3.0,
  platinum: 4.0,
  diamond: 5.0,
};

export type PositionGroup = "GK" | "DEF" | "MID" | "FWD";

/**
 * Expected players per side by format. A group is underrepresented when the
 * confirmed attendees in it number fewer than per-side count x 2 teams.
 */
export const FORMAT_POSITION_SHAPES: Record<number, Record<PositionGroup, number>> = {
  5: { GK: 1, DEF: 1, MID: 2, FWD: 1 },
  6: { GK: 1, DEF: 2, MID: 2, FWD: 1 },
  7: { GK: 1, DEF: 2, MID: 3, FWD: 1 },
  8: { GK: 1, DEF: 3, MID: 3, FWD: 1 },
  9: { GK: 1, DEF: 3, MID: 3, FWD: 2 },
  11: { GK: 1, DEF: 4, MID: 4, FWD: 2 },
};

export const TEAMS_PER_GAME = 2;

const SPECIFIC_POSITION_GROUPS: Record<string, PositionGroup> = {
  GK: "GK",
  CB: "DEF",
  RB: "DEF",
  LB: "DEF",
  CDM: "MID",
  CM: "MID",
  CAM: "MID",
  LW: "FWD",
  RW: "FWD",
  ST: "FWD",
};

const GROUP_NOUNS: Record<PositionGroup, string> = {
  GK: "keeper",
  DEF: "defender",
  MID: "midfielder",
  FWD: "attacker",
};

export type TimeBucket = "morning" | "afternoon" | "evening" | "night";

/** ET hour ranges: morning 5-11, afternoon 12-16, evening 17-20, night 21-4. */
export function timeBucketForHour(hour: number): TimeBucket {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etSlot(iso: string): { dow: number; bucket: TimeBucket } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = ET_PARTS.formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const dow = WEEKDAYS.indexOf(wd);
  if (dow < 0 || !Number.isFinite(hour)) return null;
  return { dow, bucket: timeBucketForHour(hour % 24) };
}

export function positionGroup(pos: string | null | undefined): PositionGroup | null {
  const raw = String(pos ?? "").trim();
  if (!raw) return null;
  const specific = SPECIFIC_POSITION_GROUPS[raw.toUpperCase()];
  if (specific) return specific;
  const p = raw.toLowerCase();
  if (p.startsWith("goal") || p === "keeper") return "GK";
  if (p.startsWith("def")) return "DEF";
  if (p.startsWith("mid")) return "MID";
  if (p.startsWith("att") || p.startsWith("for") || p.startsWith("strik")) return "FWD";
  return null;
}

/** Short label for a stored position: specific codes stay as codes ("CB"), broad ones become nouns. */
export function positionLabel(pos: string | null | undefined): string | null {
  const raw = String(pos ?? "").trim();
  if (!raw) return null;
  if (SPECIFIC_POSITION_GROUPS[raw.toUpperCase()]) return raw.toUpperCase();
  const g = positionGroup(raw);
  return g ? GROUP_NOUNS[g].charAt(0).toUpperCase() + GROUP_NOUNS[g].slice(1) : null;
}

function needsLabel(pos: string): string {
  const raw = pos.trim().toUpperCase();
  if (raw === "GK") return "Needs a keeper";
  if (SPECIFIC_POSITION_GROUPS[raw]) return `Needs a ${raw}`;
  const g = positionGroup(pos);
  if (!g) return "Needs your position";
  const noun = GROUP_NOUNS[g];
  return `Needs ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
}

/** Per-side shape for a format like "7v7"; falls back to half the capacity. Null when neither is usable. */
export function formatShape(format: string | null | undefined, capacity?: number | null): Record<PositionGroup, number> | null {
  const m = /(\d+)\s*v\s*\d+/i.exec(String(format ?? ""));
  let perSide = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(perSide) && capacity != null && capacity > 0) perSide = Math.floor(capacity / TEAMS_PER_GAME);
  if (!Number.isFinite(perSide) || perSide < 5) return perSide >= 1 ? FORMAT_POSITION_SHAPES[5] : null;
  const sizes = Object.keys(FORMAT_POSITION_SHAPES).map(Number).sort((a, b) => a - b);
  let best = sizes[0]!;
  for (const s of sizes) if (s <= perSide) best = s;
  return FORMAT_POSITION_SHAPES[best]!;
}

/** Level used for scoring: real star when present, otherwise the tier stand-in. */
export function internalStar(row: { star_rating?: number | string | null; tier?: string | null } | null | undefined): number | null {
  if (!row) return null;
  const n = row.star_rating == null ? NaN : Number(row.star_rating);
  if (Number.isFinite(n)) return n;
  const t = String(row.tier ?? "").trim().toLowerCase();
  return TIER_STAR_FALLBACK[t] ?? null;
}

export function averageOf(values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!known.length) return null;
  return known.reduce((s, v) => s + v, 0) / known.length;
}

/** Average confirmed attendee level, or min_star when nobody with a level is going. */
export function gameLevel(attendeeStars: Array<number | null | undefined>, minStar: number | null | undefined): number | null {
  const avg = averageOf(attendeeStars);
  if (avg != null) return avg;
  return minStar != null && Number.isFinite(minStar) ? minStar : null;
}

export type ScoringPlayer = {
  star: number | null;
  primaryPosition: string | null;
  secondaryPositions: string[];
  maxDriveMinutes: number;
};

export type ScoringGame = {
  startAt: string;
  format: string | null;
  capacity: number | null;
  minStar: number | null;
  attendeeStars: Array<number | null>;
  attendeePositions: Array<string | null>;
  attendeeIds: string[];
};

export type ScoringContext = {
  driveMinutes: number | null;
  playedWithIds: ReadonlySet<string>;
  pastGameStarts: string[];
};

export type CompatibilityResult = {
  score: number;
  components: Record<CompatibilityComponent, number>;
  reasons: string[];
  playedWithAttendeeIds: string[];
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function levelFit(userStar: number | null, level: number | null): number {
  if (userStar == null || level == null) return NEUTRAL_LEVEL_FIT;
  return clamp01(1 - Math.abs(userStar - level) / 2);
}

/** 1 when the primary position's group is short, 0.5 when a secondary one is, else 0. No position data scores 0. */
export function positionNeed(
  player: Pick<ScoringPlayer, "primaryPosition" | "secondaryPositions">,
  game: Pick<ScoringGame, "format" | "capacity" | "attendeePositions">,
): { value: number; position: string | null } {
  const shape = formatShape(game.format, game.capacity);
  if (!shape) return { value: 0, position: null };
  const counts: Record<PositionGroup, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of game.attendeePositions) {
    const g = positionGroup(p);
    if (g) counts[g] += 1;
  }
  const short = (g: PositionGroup | null) => g != null && counts[g] < shape[g] * TEAMS_PER_GAME;
  if (player.primaryPosition && short(positionGroup(player.primaryPosition))) {
    return { value: 1, position: player.primaryPosition };
  }
  for (const s of player.secondaryPositions) {
    if (short(positionGroup(s))) return { value: 0.5, position: s };
  }
  return { value: 0, position: null };
}

export function distanceFit(driveMinutes: number | null, maxDriveMinutes: number): number {
  if (driveMinutes == null || !(maxDriveMinutes > 0)) return 0;
  return clamp01(1 - driveMinutes / maxDriveMinutes);
}

export function usualTimeFit(startAt: string, pastGameStarts: string[]): { value: number; bucket: TimeBucket | null } {
  const slot = etSlot(startAt);
  if (!slot) return { value: 0, bucket: null };
  const past = pastGameStarts.map(etSlot).filter((s): s is NonNullable<typeof s> => s != null);
  if (past.length < USUAL_TIME_MIN_HISTORY) return { value: 0, bucket: slot.bucket };
  const exact = past.filter((s) => s.dow === slot.dow && s.bucket === slot.bucket).length / past.length;
  const sameBucket = past.filter((s) => s.bucket === slot.bucket).length / past.length;
  return { value: clamp01(USUAL_TIME_BLEND.exact * exact + USUAL_TIME_BLEND.bucket * sameBucket), bucket: slot.bucket };
}

function usualLabel(bucket: TimeBucket | null): string {
  if (bucket === "morning") return "Your usual morning";
  if (bucket === "afternoon") return "Your usual afternoon";
  return "Your usual night";
}

export function scoreCompatibility(player: ScoringPlayer, game: ScoringGame, ctx: ScoringContext): CompatibilityResult {
  const level = gameLevel(game.attendeeStars, game.minStar);
  const levelValue = levelFit(player.star, level);
  const pos = positionNeed(player, game);
  const dist = distanceFit(ctx.driveMinutes, player.maxDriveMinutes);
  const playedWithAttendeeIds = game.attendeeIds.filter((id) => ctx.playedWithIds.has(id));
  const playedWith = Math.min(playedWithAttendeeIds.length / PLAYED_WITH_SATURATION, 1);
  const usual = usualTimeFit(game.startAt, ctx.pastGameStarts);

  const components: Record<CompatibilityComponent, number> = {
    level: levelValue,
    position: pos.value,
    distance: dist,
    playedWith,
    usualTime: usual.value,
  };

  let score = 0;
  for (const key of Object.keys(COMPATIBILITY_WEIGHTS) as CompatibilityComponent[]) {
    score += COMPATIBILITY_WEIGHTS[key] * components[key];
  }

  const labels: Record<CompatibilityComponent, string | null> = {
    level: player.star != null && level != null ? "At your level" : null,
    position: pos.position ? needsLabel(pos.position) : null,
    distance: ctx.driveMinutes != null ? `${Math.round(ctx.driveMinutes)} min away` : null,
    playedWith: playedWithAttendeeIds.length > 0 ? `${playedWithAttendeeIds.length} you've played with` : null,
    usualTime: usualLabel(usual.bucket),
  };

  const reasons = (Object.keys(COMPATIBILITY_WEIGHTS) as CompatibilityComponent[])
    .filter((k) => labels[k] != null && components[k] >= REASON_THRESHOLDS[k])
    .sort((a, b) => COMPATIBILITY_WEIGHTS[b] * components[b] - COMPATIBILITY_WEIGHTS[a] * components[a])
    .slice(0, MAX_REASONS)
    .map((k) => labels[k]!);

  return { score: clamp01(score), components, reasons, playedWithAttendeeIds };
}
