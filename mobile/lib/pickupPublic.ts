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
  /** Same gate as `invitedNow` for public runs; invite row for select runs. */
  canParticipateInPlanning?: boolean;
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

import {
  fmtPickupDateTimeEt,
  fmtPickupRunDateDisplay,
  fmtPickupSlotChipEt,
  fmtPickupTimeEt as fmtPickupKickoffTimeEt,
  isPickupRunTimeTbd,
} from "@/lib/pickup/runStartAtDisplay";

export { fmtPickupRunDateDisplay, fmtPickupSlotChipEt, isPickupRunTimeTbd };

/** Admin schedule line: date with "Time TBD" while the poll is open or the run's time is TBD. */
export function fmtPickupRunScheduleEt(
  startAt: string | null | undefined,
  status: string | null | undefined,
  finalSlotId: string | null | undefined,
  timeTbd = false,
): string {
  if (timeTbd || isPickupRunTimeTbd(status, finalSlotId)) {
    const date = fmtPickupRunDateDisplay(startAt);
    return date === "TBD" ? "Time TBD" : `${date} · Time TBD`;
  }
  return fmtPickupDtEt(startAt);
}

/** Non-run timestamps (updates, posts) in Eastern time. */
export function fmtPickupDt(dt: string | null | undefined): string {
  if (!dt) return "TBD";
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return "TBD";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
}

export function fmtPickupDtEt(dt: string | null | undefined, timeTbd = false): string {
  if (!dt) return "No time set yet";
  return fmtPickupDateTimeEt(dt, timeTbd);
}

export function fmtPickupDateEt(dt: string | null | undefined): string {
  return fmtPickupRunDateDisplay(dt);
}

export function fmtPickupTimeEt(dt: string | null | undefined, timeTbd = false): string {
  if (!dt) return "No time set yet";
  return fmtPickupKickoffTimeEt(dt, timeTbd);
}
