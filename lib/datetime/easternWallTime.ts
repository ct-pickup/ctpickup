import { DateTime } from "luxon";

const TZ = "America/New_York";

/**
 * Convert a stored timestamptz ISO string to `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`.
 * The value represents wall clock in Eastern Time (handles DST).
 */
export function isoTimestamptzToEasternDatetimeLocal(iso: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) return "";
  return dt.setZone(TZ).toFormat("yyyy-MM-dd'T'HH:mm");
}

/**
 * Parse admin `datetime-local` value as Eastern wall time → UTC ISO for the database.
 * Accepts `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`.
 */
export function easternDatetimeLocalToIsoUtc(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let dt = DateTime.fromFormat(s, "yyyy-MM-dd'T'HH:mm", { zone: TZ });
  if (!dt.isValid) {
    dt = DateTime.fromFormat(s, "yyyy-MM-dd'T'HH:mm:ss", { zone: TZ });
  }
  if (!dt.isValid) return null;

  const iso = dt.toUTC().toISO();
  return iso ?? null;
}

/**
 * Time-TBD `start_at`: noon Eastern on the given calendar day (DST-aware), stored with `time_tbd = true`.
 * Noon keeps the Eastern date stable for display, seasons and day grouping.
 */
export function pickupTimeTbdStartAtFromEtCalendarParts(year: number, month: number, day: number): string {
  const dt = DateTime.fromObject(
    { year: Math.trunc(year), month: Math.trunc(month), day: Math.trunc(day), hour: 12 },
    { zone: TZ },
  );
  const iso = dt.isValid && dt.day === Math.trunc(day) ? dt.toUTC().toISO() : null;
  if (!iso) throw new RangeError("Invalid time-TBD start_at calendar parts");
  return iso;
}

/** `YYYY-MM-DD` Eastern calendar day → time-TBD `start_at` (noon Eastern). */
export function pickupTimeTbdStartAtFromDateString(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new RangeError("Invalid date; expected YYYY-MM-DD");
  return pickupTimeTbdStartAtFromEtCalendarParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Time-TBD `start_at` on the Eastern calendar day of a kickoff instant. */
export function pickupTimeTbdStartAtFromEtInstant(isoUtc: string): string {
  const dt = DateTime.fromISO(isoUtc, { setZone: true }).setZone(TZ);
  if (!dt.isValid) throw new RangeError("Invalid instant for time-TBD start_at");
  return pickupTimeTbdStartAtFromEtCalendarParts(dt.year, dt.month, dt.day);
}

export type PickupStartInput = { start_at: string; time_tbd: boolean };

/**
 * Parse a host/admin kickoff input. Eastern wall time when ambiguous.
 * - `YYYY-MM-DD` (a day with no time) → noon Eastern on that day, `time_tbd: true`
 * - `YYYY-MM-DDTHH:mm` (no offset) → Eastern wall clock → UTC instant
 * - ISO with `Z` or offset → absolute instant
 */
export function parsePickupStartInput(raw: string): PickupStartInput | null {
  const s = raw.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    try {
      return { start_at: pickupTimeTbdStartAtFromDateString(s), time_tbd: true };
    } catch {
      return null;
    }
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const dt = DateTime.fromISO(s, { setZone: true });
    const iso = dt.isValid ? dt.toUTC().toISO() : null;
    return iso ? { start_at: iso, time_tbd: false } : null;
  }

  const iso = easternDatetimeLocalToIsoUtc(s);
  return iso ? { start_at: iso, time_tbd: false } : null;
}

/**
 * Host session kickoff from the request body: `start_date` (`YYYY-MM-DD`, Eastern) with an optional
 * `start_time` (`HH:mm`, Eastern), or a `start_at` value (see `parsePickupStartInput`). No time → time TBD.
 */
export function pickupStartFromHostBody(body: { start_date?: unknown; start_time?: unknown; start_at?: unknown }): PickupStartInput | null {
  const date = body.start_date != null ? String(body.start_date).trim() : "";
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const time = body.start_time != null ? String(body.start_time).trim() : "";
    if (!time) return parsePickupStartInput(date);
    if (!/^\d{2}:\d{2}$/.test(time)) return null;
    return parsePickupStartInput(`${date}T${time}`);
  }
  const raw = body.start_at != null ? String(body.start_at).trim() : "";
  return raw ? parsePickupStartInput(raw) : null;
}

/** Admin datetime input → UTC ISO. A bare `YYYY-MM-DD` resolves to noon Eastern (time TBD). */
export function parsePickupAdminDatetimeToUtcIso(raw: string): string | null {
  return parsePickupStartInput(raw)?.start_at ?? null;
}
