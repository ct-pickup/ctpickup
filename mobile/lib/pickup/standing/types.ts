export type PickupStandingLevel = "good" | "warning" | "suspended" | "banned";

export type PickupStandingAutoCode =
  | "no_show_warn"
  | "no_show_suspend"
  | "late_cancel_warn"
  | "pickup_payment_warn"
  | "pickup_payment_suspend"
  | "missing_waiver";
