/** Captain rows that still occupy a team slot (not rejected / expired). */
export const ACTIVE_OUTDOOR_CAPTAIN_STATUSES = [
  "claim_submitted",
  "captain_not_verified",
  "payment_pending",
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
  "confirmed",
] as const;

/** Paid or fully cleared for play — used for official counts, join catalog, bracket team pool. */
export const PAID_OR_READY_CAPTAIN_STATUSES = [
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
  "confirmed",
] as const;

export function isActiveCaptainClaimStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim();
  return ACTIVE_OUTDOOR_CAPTAIN_STATUSES.includes(s as (typeof ACTIVE_OUTDOOR_CAPTAIN_STATUSES)[number]);
}

export function isPaidOrReadyCaptainStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim();
  return PAID_OR_READY_CAPTAIN_STATUSES.includes(s as (typeof PAID_OR_READY_CAPTAIN_STATUSES)[number]);
}

/** Captain may manage roster / invites after Stripe captured. */
export function captainMayManageRosterStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim();
  return (
    s === "payment_received" ||
    s === "roster_pending" ||
    s === "verification_in_progress" ||
    s === "flagged_for_review" ||
    s === "confirmed"
  );
}
