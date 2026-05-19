/** Deep link opened by the mobile app after Stripe Checkout completes. */
export const MOBILE_PICKUP_CHECKOUT_SUCCESS_URL = "ctpickup://pickup?paid=1";
export const MOBILE_PICKUP_CHECKOUT_CANCEL_URL = "ctpickup://pickup?canceled=1";

export function isMobileCheckoutReturn(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const v = (body as { checkout_return?: unknown }).checkout_return;
  return v === "mobile" || v === "app";
}

export function pickupCheckoutSuccessUrl(baseUrl: string, mobile: boolean): string {
  return mobile
    ? MOBILE_PICKUP_CHECKOUT_SUCCESS_URL
    : `${baseUrl}${PICKUP_CHECKOUT_RETURN_PATH}?paid=1`;
}

export function pickupCheckoutCancelUrl(baseUrl: string, mobile: boolean): string {
  return mobile
    ? MOBILE_PICKUP_CHECKOUT_CANCEL_URL
    : `${baseUrl}${PICKUP_CHECKOUT_RETURN_PATH}?canceled=1`;
}

/** Web success page path — redirects native clients to the app scheme. */
export const PICKUP_CHECKOUT_RETURN_PATH = "/pickup/checkout-return";

export function isMobileWebUserAgent(ua: string | null): boolean {
  if (!ua) return false;
  return /iPhone|iPad|iPod|Android/i.test(ua);
}
