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
