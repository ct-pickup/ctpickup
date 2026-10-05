import { addDays, weekDays, weekStart } from "./homeCalendar";
import { finderHubById } from "./finderHubs";
import { etDateKey, runTimeTbd } from "./pickup/runStartAtDisplay";

export type DayFilter = { kind: "today" } | { kind: "week" } | { kind: "date"; key: string };
export type TimeOfDay = "morning" | "afternoon" | "evening";
export type PriceFilter = "free" | "paid";
/** A star range from the existing skill bands, e.g. 3.5 to 4.0. */
export type StarRange = { low: number; high: number };

export type FinderFilters = {
  /** A hub id from finderHubs, or null for Nearby (no distance cut). */
  hubId: string | null;
  day: DayFilter | null;
  timeOfDay: TimeOfDay | null;
  stars: StarRange | null;
  price: PriceFilter | null;
};

export const NO_FINDER_FILTERS: FinderFilters = { hubId: null, day: null, timeOfDay: null, stars: null, price: null };

/** The part of a game the finder filters on. */
export type FinderRun = {
  id: string;
  start_at: string;
  time_tbd?: boolean;
  latitude: number | null;
  longitude: number | null;
  fee_cents: number;
};

export function activeFilterCount(f: FinderFilters): number {
  return [f.hubId, f.day, f.timeOfDay, f.stars, f.price].filter((v) => v != null).length;
}

/** Great-circle distance in miles. */
export function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Eastern hour of day (0-23) of a kickoff, or null when unreadable. */
export function etHour(iso: string): number | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(d));
  return Number.isFinite(h) ? h % 24 : null;
}

/** Morning before noon, afternoon noon to 5 PM, evening from 5 PM. Eastern time. */
export function timeOfDayOf(iso: string): TimeOfDay | null {
  const h = etHour(iso);
  if (h == null) return null;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function matchesDay(run: FinderRun, day: DayFilter, todayKey: string): boolean {
  const key = etDateKey(run.start_at);
  if (!key) return false;
  if (day.kind === "today") return key === todayKey;
  if (day.kind === "date") return key === day.key;
  // This week: today through the end of the Sunday-to-Saturday week, Eastern.
  const days = weekDays(weekStart(todayKey));
  return key >= todayKey && key <= (days[days.length - 1] ?? addDays(todayKey, 6));
}

/**
 * All active filters must match (AND). A game with no minimum level is open to everyone, so it passes any star range;
 * a game with a minimum passes when that minimum falls inside the range. Games with no kickoff time yet never match a
 * time-of-day filter. Games without coordinates never match a hub.
 */
export function filterRuns<T extends FinderRun>(
  runs: readonly T[],
  f: FinderFilters,
  minStars: ReadonlyMap<string, number>,
  now: number = Date.now(),
): T[] {
  const hub = finderHubById(f.hubId);
  const todayKey = etDateKey(now) ?? "";
  return runs.filter((r) => {
    if (hub) {
      if (r.latitude == null || r.longitude == null) return false;
      if (distanceMiles(hub.lat, hub.lng, r.latitude, r.longitude) > hub.radiusMiles) return false;
    }
    if (f.day && !matchesDay(r, f.day, todayKey)) return false;
    if (f.timeOfDay) {
      if (runTimeTbd(r) || timeOfDayOf(r.start_at) !== f.timeOfDay) return false;
    }
    if (f.stars) {
      const min = minStars.get(r.id);
      if (min != null && (min < f.stars.low || min > f.stars.high)) return false;
    }
    if (f.price === "free" && r.fee_cents > 0) return false;
    if (f.price === "paid" && !(r.fee_cents > 0)) return false;
    return true;
  });
}

/** Map zoom for a hub: its radius plus a little margin. */
export function hubRegionDelta(radiusMiles: number): number {
  return (radiusMiles * 2.4) / 69;
}
