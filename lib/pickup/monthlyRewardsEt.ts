import { DateTime } from "luxon";

const TZ = "America/New_York";

export type EtMonthRange = {
  startIso: string;
  endIso: string;
  /** yyyy-MM in Eastern */
  monthKey: string;
};

export function etNow(): DateTime {
  return DateTime.now().setZone(TZ);
}

/** Inclusive calendar month bounds in UTC ISO for queries. */
export function calendarMonthRangeEt(dt: DateTime): EtMonthRange {
  const start = dt.startOf("month");
  const end = dt.endOf("month");
  return {
    startIso: start.toUTC().toISO() ?? start.toUTC().toString(),
    endIso: end.toUTC().toISO() ?? end.toUTC().toString(),
    monthKey: dt.toFormat("yyyy-MM"),
  };
}

export function previousCalendarMonthRangeEt(now = etNow()): EtMonthRange {
  return calendarMonthRangeEt(now.minus({ months: 1 }));
}

export function currentCalendarMonthRangeEt(now = etNow()): EtMonthRange {
  return calendarMonthRangeEt(now);
}

/** Start of current calendar month in ET (for idempotent monthly award checks). */
export function currentCalendarMonthStartIsoEt(now = etNow()): string {
  const start = now.startOf("month");
  return start.toUTC().toISO() ?? start.toUTC().toString();
}

export function expiresThreeMonthsFromNowIso(now = DateTime.utc()): string {
  const exp = now.plus({ months: 3 });
  return exp.toISO() ?? exp.toString();
}
