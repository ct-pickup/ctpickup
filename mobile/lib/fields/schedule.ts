import { slotStatus, type SlotStatus } from "./presentation";

export const ET_ZONE = "America/New_York";
export const SCHEDULE_FIRST_HOUR = 8;
export const SCHEDULE_LAST_HOUR = 20;

export type DbSlot = { starts_at: string; ends_at: string; status: "booked" | "pending"; title: string | null };
export type OwnRequest = { requested_date: string; start_time: string; duration_hours: number };
export type ScheduleRow = { hour: number; label: string; status: SlotStatus; title: string | null };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Venue-local (Eastern) calendar date and clock for an instant. */
export function etParts(d: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

/** Minutes on a shared "local clock" axis, so Eastern times compare without caring about the UTC offset. */
function localMinutes(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, hour, minute) / 60000;
}

function instantMinutes(iso: string): number {
  const p = etParts(new Date(iso));
  return localMinutes(p.date, p.hour, p.minute);
}

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

/** `count` days starting at the Eastern date of `now`. */
export function scheduleDays(now: Date, count = 7): { iso: string; weekday: string; dayNum: number }[] {
  const start = etParts(now).date;
  const [y, m, d] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    return { iso: dt.toISOString().slice(0, 10), weekday: WEEKDAYS[dt.getUTCDay()]!, dayNum: dt.getUTCDate() };
  });
}

/**
 * Hour-by-hour view of one day at one venue. Open appears only when `calendarConnected` is true; otherwise a free hour is
 * Unknown. Known bookings and the player's own requests show either way.
 */
export function buildDay(args: {
  date: string;
  slots: DbSlot[];
  ownRequests: OwnRequest[];
  calendarConnected: boolean;
  firstHour?: number;
  lastHour?: number;
}): ScheduleRow[] {
  const first = args.firstHour ?? SCHEDULE_FIRST_HOUR;
  const last = args.lastHour ?? SCHEDULE_LAST_HOUR;
  const slots = args.slots.map((s) => ({ ...s, a: instantMinutes(s.starts_at), b: instantMinutes(s.ends_at) }));
  const mine = args.ownRequests
    .filter((r) => r.requested_date === args.date)
    .map((r) => {
      const [h, m] = r.start_time.split(":").map(Number);
      const a = localMinutes(args.date, h ?? 0, m ?? 0);
      return { a, b: a + Math.round(Number(r.duration_hours) * 60) };
    });

  const rows: ScheduleRow[] = [];
  for (let hour = first; hour <= last; hour++) {
    const wa = localMinutes(args.date, hour);
    const wb = wa + 60;
    const overlaps = (a: number, b: number) => a < wb && b > wa;
    const yourRequest = mine.some((r) => overlaps(r.a, r.b));
    const hit = slots.filter((s) => overlaps(s.a, s.b));
    const booked = hit.find((s) => s.status === "booked");
    const pending = hit.find((s) => s.status === "pending");
    const status = slotStatus({ calendarConnected: args.calendarConnected, booked: !!booked, pending: !!pending, yourRequest });
    const title = yourRequest ? "Your pickup game" : (booked ?? pending)?.title ?? null;
    rows.push({ hour, label: hourLabel(hour), status, title });
  }
  return rows;
}

/**
 * Status of one requested window (date, start "HH:MM", length in hours) at a venue. Same rule as the schedule screen:
 * a booking we hold always shows (Booked, or Pending for a pending hold), a free window is Open only when the venue's
 * calendar is connected and Unknown otherwise.
 */
export function windowStatus(args: {
  date: string;
  start: string;
  hours: number;
  slots: DbSlot[];
  calendarConnected: boolean;
}): SlotStatus {
  const [h, m] = args.start.split(":").map(Number);
  const a = localMinutes(args.date, h ?? 0, m ?? 0);
  const b = a + Math.round(args.hours * 60);
  const hit = args.slots.map((s) => ({ s, a: instantMinutes(s.starts_at), b: instantMinutes(s.ends_at) })).filter((x) => x.a < b && x.b > a);
  return slotStatus({
    calendarConnected: args.calendarConnected,
    booked: hit.some((x) => x.s.status === "booked"),
    pending: hit.some((x) => x.s.status === "pending"),
    yourRequest: false,
  });
}
