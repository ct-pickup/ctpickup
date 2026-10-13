export type DayOption = { iso: string; weekday: string; dayNum: number; long: string };

export const TIME_OPTIONS = [
  { value: "09:00", label: "9:00 AM" },
  { value: "11:00", label: "11:00 AM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "18:00", label: "6:00 PM" },
] as const;

export const REQUEST_HOURS = 2;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 30;
export const DEFAULT_PLAYERS = 14;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The next `count` Saturdays and Sundays strictly after today, as local calendar dates. */
export function weekendDays(from: Date, count = 4): DayOption[] {
  const out: DayOption[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 6 || dow === 0) {
      out.push({
        iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        weekday: WEEKDAYS[dow]!,
        dayNum: d.getDate(),
        long: `${WEEKDAYS[dow]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`,
      });
    }
  }
  return out;
}

export function timeLabel(value: string): string {
  return TIME_OPTIONS.find((t) => t.value === value)?.label ?? value;
}

export function clampPlayers(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(n)));
}
