/** Rules for a field request's date, start time and length. Shared by the app (what it offers) and the API (what it accepts). */

export const MAX_DAYS_AHEAD = 30;
export const DURATIONS = [1, 1.5, 2] as const;
export const DEFAULT_DURATION = 2;
export const FIRST_START_HOUR = 7;
export const LAST_START_HOUR = 21;

/** "07:00", "07:30" ... "21:00": every 30 minutes from 7 AM to 9 PM, 29 options. */
export const START_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = FIRST_START_HOUR; h <= LAST_START_HOUR; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < LAST_START_HOUR) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

/** Accepts "11:00" or "11:00:00". */
export function isValidStartTime(value: unknown): boolean {
  return typeof value === "string" && START_TIMES.includes(value.trim().slice(0, 5)) && /^\d{2}:\d{2}(:00)?$/.test(value.trim());
}

export function isValidDuration(value: unknown): boolean {
  return typeof value === "number" && (DURATIONS as readonly number[]).includes(value);
}

/** Today's calendar date in Eastern time ("2026-10-13"). The venues are in Connecticut, so "today" is Eastern. */
export function etToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** A request must be for a day after today and no more than 30 days out. Weekdays are fine. */
export function isDateInWindow(date: string, todayEt: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > todayEt && date <= addDaysIso(todayEt, MAX_DAYS_AHEAD);
}

/** "7:00 AM", "12:30 PM". */
export function timeLabel12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function durationLabel(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
