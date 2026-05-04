export type PickupPublicCounts = {
  confirmed?: number;
  standby?: number;
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

/** Short time for hero cards (locale default). */
export function fmtPickupTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}
