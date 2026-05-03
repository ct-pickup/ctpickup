export type PickupPublicPayload = {
  status?: string;
  /** Latest RSVP status for the signed-in user (from `/api/pickup/public`). */
  my_status?: string | null;
  run?: Record<string, unknown> | null;
  counts?: {
    confirmed?: number;
    standby?: number;
    pending_payment?: number;
    tier1Confirmed?: number;
  };
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
