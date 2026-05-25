export type PickupPublicCounts = {
  confirmed?: number;
  standby?: number;
  waitlist?: number;
  pending_confirm?: number;
  pending_payment?: number;
  tier1Confirmed?: number;
};

export type PickupPublicVisibility = {
  invitedNow?: boolean;
  attendanceVisible?: boolean;
};

export type PickupPublicMe = {
  approved?: boolean;
  is_admin?: boolean;
  tier?: string | null;
  tier_rank?: number | null;
};

export type PickupPublicPayload = {
  status?: string;
  /** Latest RSVP status for the signed-in user (from `/api/pickup/public`). */
  my_status?: string | null;
  /** Waitlist position when `my_status === "waitlist"` (1-indexed). */
  my_waitlist_position?: number | null;
  /** ISO timestamp when a `pending_confirm` offer expires. */
  my_waitlist_expires_at?: string | null;
  run?: Record<string, unknown> | null;
  counts?: PickupPublicCounts;
  visibility?: PickupPublicVisibility;
  me?: PickupPublicMe;
};

export function parsePickupPayload(data: unknown): PickupPublicPayload {
  if (!data || typeof data !== "object") return {};
  return data as PickupPublicPayload;
}

/** True when `start_at` encodes only a calendar day (midnight UTC), not a real kickoff. */
export function isPickupRunDateOnlyStartAt(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d{3})?Z$/i.test(s);
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

/** Kickoff time not chosen yet (availability poll / admin finalize pending). */
export function isPickupRunTimeTbd(
  status: string | null | undefined,
  finalSlotId: string | null | undefined,
): boolean {
  if (finalSlotId != null && String(finalSlotId).trim() !== "") return false;
  const st = (status ?? "").trim();
  return st === "planning" || st === "likely_on";
}

export function fmtPickupRunScheduleEt(
  startAt: string | null | undefined,
  status: string | null | undefined,
  finalSlotId: string | null | undefined,
): string {
  if (isPickupRunTimeTbd(status, finalSlotId)) {
    const date =
      isPickupRunDateOnlyStartAt(startAt) && startAt
        ? fmtPickupDateFromDateOnlyStartAt(startAt)
        : fmtPickupDateEt(startAt);
    return date === "TBD" ? "Time TBD" : `${date} · Time TBD`;
  }
  return fmtPickupDtEt(startAt);
}

export function fmtPickupDt(dt: string | null | undefined): string {
  if (!dt) return "TBD";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "TBD";
  }
}

const ET_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function fmtPickupDtEt(dt: string | null | undefined): string {
  if (!dt) return "No time set yet";
  try {
    return new Date(dt).toLocaleString("en-US", ET_OPTS);
  } catch {
    return "—";
  }
}

export function fmtPickupDateEt(dt: string | null | undefined): string {
  if (!dt) return "TBD";
  try {
    return new Date(dt).toLocaleString("en-US", {
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

/** Chip label: "Mon, May 22 · 8:00 PM" (Eastern). */
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

export function fmtPickupTimeEt(dt: string | null | undefined): string {
  if (!dt) return "No time set yet";
  try {
    return new Date(dt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Short time for hero cards (locale default). */
export function fmtPickupTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}
