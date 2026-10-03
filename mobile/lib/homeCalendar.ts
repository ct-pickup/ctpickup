/**
 * Calendar-grid math for the Home week strip and month sheet. Keys are `YYYY-MM-DD` calendar days.
 * Which day a game falls on is NOT decided here: use etDateKey() from lib/pickup/runStartAtDisplay.
 */

export type DateKey = string;

const DAY_MS = 86_400_000;
export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function toUtc(key: DateKey): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): DateKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: DateKey, n: number): DateKey {
  return fromUtc(toUtc(key) + n * DAY_MS);
}

/** 0 = Sunday. */
export function weekdayOf(key: DateKey): number {
  return new Date(toUtc(key)).getUTCDay();
}

export function weekStart(key: DateKey): DateKey {
  return addDays(key, -weekdayOf(key));
}

export function weekDays(start: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Whole weeks from week start `a` to week start `b`. */
export function weeksBetween(a: DateKey, b: DateKey): number {
  return Math.round((toUtc(b) - toUtc(a)) / (7 * DAY_MS));
}

export function dayNumber(key: DateKey): number {
  return Number(key.slice(8, 10));
}

export type YearMonth = { year: number; month: number };

export function monthOf(key: DateKey): YearMonth {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Six Sunday-first weeks covering the month. */
export function monthGrid(ym: YearMonth): DateKey[] {
  const first = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthLabel(ym: YearMonth): string {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** "Wed, Oct 7". */
export function dayLabel(key: DateKey): string {
  return new Date(toUtc(key)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Wed". */
export function weekdayShort(key: DateKey): string {
  return new Date(toUtc(key)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

function shortDate(key: DateKey): string {
  return new Date(toUtc(key)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/**
 * Strip header: the selected day's month ("October 2026"), or the range ("Sep 27 – Oct 3") when the visible
 * week spans two months.
 */
export function weekHeaderLabel(visibleWeekStart: DateKey, selected: DateKey): string {
  const days = weekDays(visibleWeekStart);
  if (monthOf(days[0]).month !== monthOf(days[6]).month) return `${shortDate(days[0])} – ${shortDate(days[6])}`;
  return monthLabel(monthOf(selected));
}
