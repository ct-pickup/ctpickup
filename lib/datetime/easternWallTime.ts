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
 * Pickup planning `start_at` date anchor: midnight UTC whose Y-M-D matches the Eastern calendar day
 * (see `isPickupRunDateOnlyStartAt` / `fmtPickupDateFromDateOnlyStartAt`).
 */
export function pickupDateOnlyStartAtFromEtCalendarParts(
  year: number,
  month: number,
  day: number,
): string {
  const iso = DateTime.utc(year, month, day, 0, 0, 0, 0).toISO();
  if (!iso) {
    throw new RangeError("Invalid date-only start_at for Eastern calendar day");
  }
  return iso;
}

/** Derive date-only `start_at` from a kickoff instant (uses Eastern wall-clock date). */
export function pickupDateOnlyStartAtFromEtInstant(isoUtc: string): string {
  const dt = DateTime.fromISO(isoUtc, { setZone: true }).setZone(TZ);
  if (!dt.isValid) {
    throw new RangeError("Invalid instant for date-only start_at");
  }
  return pickupDateOnlyStartAtFromEtCalendarParts(dt.year, dt.month, dt.day);
}

/**
 * Parse admin pickup datetime input as Eastern wall time when ambiguous.
 * - `YYYY-MM-DD` → date-only anchor (midnight UTC on that Eastern calendar day)
 * - `YYYY-MM-DDTHH:mm` (no offset) → Eastern wall clock → UTC instant
 * - ISO with `Z` or offset → absolute instant (already UTC-correct)
 */
export function parsePickupAdminDatetimeToUtcIso(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    try {
      return pickupDateOnlyStartAtFromEtCalendarParts(year, month, day);
    } catch {
      return null;
    }
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const dt = DateTime.fromISO(s, { setZone: true });
    if (!dt.isValid) return null;
    return dt.toUTC().toISO();
  }

  return easternDatetimeLocalToIsoUtc(s);
}
