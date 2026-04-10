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
