/**
 * Discover: the five players picked for a user each week, and exact-match search.
 *
 * Pure: no Supabase, no React, so both the route and the app can use it. The
 * score and its components never leave the server; routes return reason chips only.
 */

/** Picks per user per week. */
export const DISCOVER_PICK_COUNT = 5;

/** Exact-match search never returns more than this. */
export const SEARCH_MAX_RESULTS = 3;

/** Search calls allowed per user per rolling hour. */
export const SEARCH_HITS_PER_HOUR = 30;

/** Reason chips shown under a card. */
export const MAX_DISCOVER_REASONS = 2;

/** Mutual teammates saturate here, mirroring PLAYED_WITH_SATURATION in match scoring. */
export const MUTUAL_SATURATION = 3;

/**
 * Component weights, mirroring COMPATIBILITY_WEIGHTS. Player-to-player has no
 * usual-time component, so that weight is spread across distance and mutuals.
 */
export const DISCOVER_WEIGHTS = {
  level: 0.4,
  position: 0.2,
  distance: 0.25,
  mutuals: 0.15,
} as const;

export type DiscoverComponent = keyof typeof DISCOVER_WEIGHTS;

/** Minimum component value (0..1) before a component is offered as a reason. */
export const DISCOVER_REASON_THRESHOLDS: Record<DiscoverComponent, number> = {
  level: 0.75,
  position: 1,
  distance: 0.5,
  mutuals: 1 / 3,
};

/** The only player fields Discover ever returns. No location, contact, score, tier or reliability. */
export type DiscoverPlayer = {
  id: string;
  /** "Sam R." */
  name: string;
  avatarUrl: string;
  star: number | null;
  /** "Confident" */
  levelName: string | null;
  /** "CB" */
  position: string | null;
  /** "Westport" */
  town: string | null;
  reasons: string[];
};

export type DiscoverResponse = {
  weekStart: string;
  players: DiscoverPlayer[];
};

export type SearchResponse = { players: DiscoverPlayer[] };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The Monday that starts the current week in America/New_York, as YYYY-MM-DD.
 * Picks are fixed from Monday 00:00 ET, so everyone rolls over together
 * regardless of where the server runs.
 */
export function weekStartET(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const index = WEEKDAYS.indexOf(part("weekday") as (typeof WEEKDAYS)[number]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || index < 0) {
    throw new Error("Could not read the current Eastern date.");
  }

  // Monday starts the week, so Sunday steps back six days.
  const back = index === 0 ? 6 : index - 1;
  const monday = new Date(Date.UTC(year, month - 1, day) - back * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Display name: first name plus last initial, never the full surname. */
export function displayName(firstName: string | null | undefined, lastInitial: string | null | undefined): string {
  const first = String(firstName ?? "").trim();
  const initial = String(lastInitial ?? "").trim();
  if (!first) return "Player";
  return initial ? `${first} ${initial}.` : first;
}

/** Collapses case and whitespace so an exact full-name match is forgiving of spacing. */
export function normalizeFullName(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Strips a leading @ and lowercases, for exact username match. */
export function normalizeHandle(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
}

/** True when the query is a handle lookup rather than a name lookup. */
export function looksLikeHandle(raw: string): boolean {
  return raw.trim().startsWith("@");
}

export type ReasonInput = {
  /** 0..1 level closeness. */
  level: number;
  /** 0..1, 1 only when the primary positions match. */
  position: number;
  /** 0..1 closeness within the viewer's max drive time. */
  distance: number;
  /** 0..1 saturating mutual teammate count. */
  mutuals: number;
  /** Shown in the position chip reason, e.g. "CB". */
  positionLabel: string | null;
  driveMinutes: number | null;
  mutualCount: number;
};

/**
 * Up to MAX_DISCOVER_REASONS chips, strongest component first. Only components at
 * or above their threshold are offered, so a weak match stays quiet rather than
 * explaining itself badly.
 */
export function discoverReasons(input: ReasonInput): string[] {
  const candidates: Array<{ component: DiscoverComponent; value: number; label: string }> = [];

  if (input.level >= DISCOVER_REASON_THRESHOLDS.level) {
    candidates.push({ component: "level", value: input.level, label: "Same level" });
  }
  if (input.position >= DISCOVER_REASON_THRESHOLDS.position && input.positionLabel) {
    candidates.push({ component: "position", value: input.position, label: `Also a ${input.positionLabel}` });
  }
  if (input.distance >= DISCOVER_REASON_THRESHOLDS.distance && input.driveMinutes != null) {
    candidates.push({
      component: "distance",
      value: input.distance,
      label: `${Math.max(1, Math.round(input.driveMinutes))} min away`,
    });
  }
  if (input.mutuals >= DISCOVER_REASON_THRESHOLDS.mutuals && input.mutualCount > 0) {
    const plural = input.mutualCount === 1 ? "teammate" : "teammates";
    candidates.push({ component: "mutuals", value: input.mutuals, label: `${input.mutualCount} mutual ${plural}` });
  }

  return candidates
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_DISCOVER_REASONS)
    .map((c) => c.label);
}

/** Weighted total of the four components. Server-only: never serialize this. */
export function discoverScore(components: Record<DiscoverComponent, number>): number {
  return (
    components.level * DISCOVER_WEIGHTS.level +
    components.position * DISCOVER_WEIGHTS.position +
    components.distance * DISCOVER_WEIGHTS.distance +
    components.mutuals * DISCOVER_WEIGHTS.mutuals
  );
}

/** Saturating mutual-teammate component. */
export function mutualsFit(count: number): number {
  if (!(count > 0)) return 0;
  return Math.min(1, count / MUTUAL_SATURATION);
}
