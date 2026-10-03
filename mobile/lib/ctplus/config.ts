/**
 * CT+ (paid card designs). Everything is behind CTPLUS_ENABLED, off unless the build sets it.
 * Expo only inlines EXPO_PUBLIC_* variables, so the flag is read from EXPO_PUBLIC_CTPLUS_ENABLED.
 * The free share card never reads any of this.
 */
export const CTPLUS_ENABLED = (process.env.EXPO_PUBLIC_CTPLUS_ENABLED ?? "").trim().toLowerCase() === "true";

/** One product: annual, $9.99. Create it in App Store Connect with this id. */
export const CTPLUS_PRODUCT_ID = "ctplus_annual";
/** RevenueCat entitlement that the product unlocks. Placeholder: create it in the RevenueCat dashboard. */
export const CTPLUS_ENTITLEMENT_ID = "ctplus";
/** Shown until the store returns the localized price. */
export const CTPLUS_FALLBACK_PRICE = "$9.99";
export const CTPLUS_PERIOD_LABEL = "year";

/** RevenueCat public iOS SDK key. */
export function revenueCatIosKey(): string | null {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() || null;
}
