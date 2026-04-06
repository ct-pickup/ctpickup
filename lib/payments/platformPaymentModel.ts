export const PLATFORM_PRODUCT_TYPES = [
  "pickup",
  "tournament",
  "sports",
  "guidance",
  "training",
] as const;

export type PlatformProductType = (typeof PLATFORM_PRODUCT_TYPES)[number];

export const PAYMENT_LIFECYCLE = [
  "checkout_started",
  "payment_received",
  "payment_failed",
  "refunded",
  "checkout_expired",
] as const;

export type PaymentLifecycleStatus = (typeof PAYMENT_LIFECYCLE)[number];

export const FULFILLMENT_STATUS = ["pending", "succeeded", "failed", "not_applicable"] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[number];

export const WEBHOOK_OUTCOMES = [
  "processed_ok",
  "processed_failed",
  "ignored",
  "received_only",
] as const;

export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/** Staff-facing line for the combined Stripe + app state. */
export function staffPaymentHeadline(row: {
  lifecycle_status: PaymentLifecycleStatus;
  fulfillment_status: FulfillmentStatus;
}): string {
  const { lifecycle_status: life, fulfillment_status: ful } = row;

  if (life === "checkout_started" && ful === "pending") {
    return "Checkout started — waiting for payment";
  }
  if (life === "checkout_expired") {
    return "Checkout expired — no payment";
  }
  if (life === "payment_failed") {
    return "Payment failed";
  }
  if (life === "refunded") {
    return "Refunded";
  }
  if (life === "payment_received" && ful === "pending") {
    return "Payment received — waiting for confirmation";
  }
  if (life === "payment_received" && ful === "succeeded") {
    return "Payment received — confirmed in app";
  }
  if (life === "payment_received" && ful === "failed") {
    return "Payment received — update needed";
  }
  if (life === "payment_received" && ful === "not_applicable") {
    return "Payment received";
  }
  return "Payment status needs review";
}

export function productTypeLabel(t: PlatformProductType): string {
  switch (t) {
    case "pickup":
      return "Pickup";
    case "tournament":
      return "Tournament";
    case "sports":
      return "Sports";
    case "guidance":
      return "Guidance";
    case "training":
      return "Training";
    default:
      return t;
  }
}

export function lifecycleLabel(l: PaymentLifecycleStatus): string {
  switch (l) {
    case "checkout_started":
      return "Checkout started";
    case "payment_received":
      return "Payment received";
    case "payment_failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    case "checkout_expired":
      return "Checkout expired";
    default:
      return l;
  }
}

export function fulfillmentLabel(f: FulfillmentStatus): string {
  switch (f) {
    case "pending":
      return "App update pending";
    case "succeeded":
      return "App updated";
    case "failed":
      return "Update needed";
    case "not_applicable":
      return "No app update";
    default:
      return f;
  }
}

export function staffProductLink(productType: PlatformProductType, _productEntityId: string): string {
  switch (productType) {
    case "pickup":
      return "/admin/pickup";
    case "tournament":
      return "/admin/tournament";
    case "guidance":
      return "/admin/guidance";
    case "training":
      return "/admin";
    case "sports":
      return "/admin/esports";
    default:
      return "/admin";
  }
}
