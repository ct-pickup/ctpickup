/**
 * The two CT+ plans, sold as the monthly and annual packages of the RevenueCat current offering.
 * Prices always come from the store (localized); the fallbacks below only show before they have loaded.
 */
export type PlanId = "monthly" | "annual";

export const PLAN_IDS: readonly PlanId[] = ["monthly", "annual"];

export const PLAN_META: Record<PlanId, { label: string; period: "month" | "year"; adverb: "monthly" | "yearly"; packageId: string }> = {
  monthly: { label: "Monthly", period: "month", adverb: "monthly", packageId: "$rc_monthly" },
  annual: { label: "Yearly", period: "year", adverb: "yearly", packageId: "$rc_annual" },
};

/** Shown only until the store returns a price. */
export const FALLBACK_PRICE: Record<PlanId, string> = { monthly: "$2.99", annual: "$19.99" };

/** The auto-renew line under Subscribe, for the selected plan. */
export function renewLine(plan: PlanId, price: string): string {
  return `Auto-renews ${PLAN_META[plan].adverb} at ${price} until canceled. Cancel anytime in your Apple ID settings.`;
}

/**
 * What the yearly plan saves against twelve monthly payments, from the live store prices.
 * Null when either price is missing or the yearly plan is not cheaper.
 */
export function annualSaving(
  monthlyPrice: number | null | undefined,
  annualPrice: number | null | undefined,
  currencyCode?: string | null,
): { percent: number; amountText: string } | null {
  if (!(typeof monthlyPrice === "number" && monthlyPrice > 0) || !(typeof annualPrice === "number" && annualPrice > 0)) return null;
  const full = monthlyPrice * 12;
  const saved = full - annualPrice;
  if (!(saved > 0)) return null;
  const percent = Math.round((saved / full) * 100);
  if (percent < 1) return null;
  let amountText: string;
  try {
    amountText = new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "USD" }).format(saved);
  } catch {
    amountText = saved.toFixed(2);
  }
  return { percent, amountText };
}
