import type { PickupStandingAutoCode } from "./types";

/** Short staff-facing labels for automatic standing codes. */
export function pickupAutoCodeLabel(code: string): string {
  const map: Record<PickupStandingAutoCode, string> = {
    no_show_warn: "No-shows crossed warning threshold (90d)",
    no_show_suspend: "No-shows crossed suspension threshold (90d)",
    late_cancel_warn: "Late cancellation in the last 90 days",
    pickup_payment_warn: "Pickup payment issue in the last 90 days",
    pickup_payment_suspend: "Repeated pickup payment issues (90d)",
    missing_waiver: "Current liability waiver not accepted",
  };
  return map[code as PickupStandingAutoCode] || code;
}
