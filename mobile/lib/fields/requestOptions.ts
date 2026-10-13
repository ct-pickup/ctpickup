import {
  addDaysIso,
  DEFAULT_DURATION,
  DURATIONS,
  etToday,
  MAX_DAYS_AHEAD,
  START_TIMES,
  timeLabel12,
} from "../../../shared/fields/requestRules";

export { DEFAULT_DURATION, DURATIONS, START_TIMES };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 30;
export const DEFAULT_PLAYERS = 14;
export const DEFAULT_START = "11:00";

export type DayOption = { iso: string; weekday: string; dayNum: number; month: string; long: string; weekend: boolean };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every day from tomorrow through 30 days out (Eastern), weekdays included. */
export function requestDays(now: Date = new Date()): DayOption[] {
  const today = etToday(now);
  return Array.from({ length: MAX_DAYS_AHEAD }, (_, i) => {
    const iso = addDaysIso(today, i + 1);
    const [y, m, d] = iso.split("-").map(Number);
    const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
    return { iso, weekday: WEEKDAYS[dow]!, dayNum: d!, month: MONTHS[m! - 1]!, long: `${WEEKDAYS[dow]}, ${MONTHS[m! - 1]} ${d}`, weekend: dow === 0 || dow === 6 };
  });
}

/** The day the screen starts on: the first weekend day in range (the usual game days), else tomorrow. */
export function defaultDay(days: DayOption[]): string {
  return (days.find((d) => d.weekend) ?? days[0]!).iso;
}

export const timeLabel = timeLabel12;

export function clampPlayers(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(n)));
}
