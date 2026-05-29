/** Midnight UTC timestamptz used as a calendar-day anchor (not a kickoff instant). */
const DATE_ONLY_MIDNIGHT_UTC =
  /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d+)?(?:Z|[+-]00(?::00)?)$/i;

/** True when `start_at` encodes only a calendar day (midnight UTC), not a real kickoff. */
export function isPickupRunDateOnlyStartAt(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return DATE_ONLY_MIDNIGHT_UTC.test(s);
}

/** Format the calendar day from a date-only `start_at` (UTC date portion, no timezone shift). */
export function fmtPickupDateFromDateOnlyStartAt(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "TBD";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return "TBD";
  try {
    return new Date(Date.UTC(y, mo, d, 12, 0, 0)).toLocaleString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "TBD";
  }
}

/** Run list/detail date line: UTC calendar day for date-only anchors, else Eastern. */
export function fmtPickupRunDateDisplay(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  if (isPickupRunDateOnlyStartAt(iso)) return fmtPickupDateFromDateOnlyStartAt(iso);
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "TBD";
  }
}

/** Kickoff time not chosen yet (availability poll / admin finalize pending). */
/** Eastern chip label: "Mon, May 22 · 8:00 PM". */
export function fmtPickupSlotChipEt(iso: string | null | undefined): string {
  if (!iso) return "Time TBD";
  try {
    const date = new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const time = new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${date} · ${time}`;
  } catch {
    return "Time TBD";
  }
}

export function isPickupRunTimeTbd(
  status: string | null | undefined,
  finalSlotId: string | null | undefined,
): boolean {
  if (finalSlotId != null && String(finalSlotId).trim() !== "") return false;
  const st = (status ?? "").trim();
  return st === "planning" || st === "likely_on";
}
