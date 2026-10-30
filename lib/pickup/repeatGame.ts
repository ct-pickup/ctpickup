import { DateTime } from "luxon";

const TZ = "America/New_York";

/**
 * The same weekday and clock time, a week after the game, in Eastern time (so a game at 6 PM stays at 6 PM across a clock change).
 * If that moment has already passed (the game was weeks ago) it moves forward a week at a time until it is in the future.
 * A game with no set time keeps no time.
 */
export function nextWeekSlot(startAtIso: string, timeTbd: boolean, now: Date = new Date()): { date: string; time: string | null } | null {
  const start = DateTime.fromISO(startAtIso, { setZone: true }).setZone(TZ);
  if (!start.isValid) return null;
  let next = start.plus({ weeks: 1 });
  for (let i = 0; i < 104 && next.toMillis() <= now.getTime(); i++) next = next.plus({ weeks: 1 });
  if (next.toMillis() <= now.getTime()) return null;
  return { date: next.toFormat("yyyy-MM-dd"), time: timeTbd ? null : next.toFormat("HH:mm") };
}

type SourceRun = Record<string, unknown>;

const TIER_KEY_BY_RANK = ["all", "bronze", "silver", "gold", "platinum", "diamond"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type RepeatPrefill = {
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  venue_key: string | null;
  capacity: number;
  format: string;
  fee_cents: number;
  invite_only: boolean;
  tiered_pricing: boolean;
  min_star: number | null;
  min_tier: string;
  date: string;
  time: string | null;
  time_tbd: boolean;
};

/**
 * What a repeat of this game starts as: the same field, size, format, price, level and kind of game, one week later.
 * A field-request link (venue_request_id) is never copied: a request is good for one game.
 */
export function repeatPrefill(run: SourceRun, now: Date = new Date()): RepeatPrefill | null {
  const startAt = str(run.start_at);
  const place = str(run.location_text);
  if (!startAt || !place) return null;
  const timeTbd = run.time_tbd === true;
  const slot = nextWeekSlot(startAt, timeTbd, now);
  if (!slot) return null;
  const rank = numOrNull(run.open_tier_rank);
  const capacity = numOrNull(run.capacity);
  return {
    location_text: place,
    latitude: numOrNull(run.latitude),
    longitude: numOrNull(run.longitude),
    venue_key: str(run.venue_key),
    capacity: capacity != null && capacity >= 4 && capacity <= 30 ? Math.trunc(capacity) : 10,
    format: ["5v5", "6v6", "7v7", "Open"].includes(String(run.format)) ? String(run.format) : "Open",
    fee_cents: Math.max(0, Math.round(numOrNull(run.fee_cents) ?? 0)),
    invite_only: run.run_type === "select",
    tiered_pricing: run.tiered_pricing === true,
    min_star: numOrNull(run.min_star),
    min_tier: rank != null && rank >= 0 && rank < TIER_KEY_BY_RANK.length ? TIER_KEY_BY_RANK[Math.trunc(rank)]! : "all",
    date: slot.date,
    time: slot.time,
    time_tbd: timeTbd,
  };
}

/** A start instant as its Eastern date and time (time null when the game has no set time). */
export function etSlot(startAtIso: string, timeTbd: boolean): { date: string; time: string | null } | null {
  const dt = DateTime.fromISO(startAtIso, { setZone: true }).setZone(TZ);
  return dt.isValid ? { date: dt.toFormat("yyyy-MM-dd"), time: timeTbd ? null : dt.toFormat("HH:mm") } : null;
}

/** "Thu 6:00 PM" for push copy. */
export function slotLabel(date: string, time: string | null): string {
  const dt = DateTime.fromISO(time ? `${date}T${time}` : date, { zone: TZ });
  if (!dt.isValid) return date;
  return time ? dt.toFormat("ccc h:mm a") : dt.toFormat("ccc, LLL d");
}

export const playAgainCopy = (hostName: string, label: string) => ({
  title: "Run it back?",
  body: `${hostName} posted the same game for ${label}. You get first look.`,
});

export const playAgainAskCopy = () => ({
  title: "Players want another game",
  body: "Some players from your last game asked you to run it again.",
});
