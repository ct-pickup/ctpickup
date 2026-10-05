/* eslint-disable @typescript-eslint/no-require-imports -- react-native-purchases needs native code, required lazily so Expo Go still loads */
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

import { CTPLUS_ENTITLEMENT_ID, revenueCatIosKey } from "@/lib/ctplus/config";
import { PLAN_IDS, PLAN_META, type PlanId } from "@/lib/ctplus/plans";

type CustomerInfo = { entitlements: { active: Record<string, unknown> } };
type StoreProduct = { identifier: string; priceString: string; price: number; currencyCode: string };
type RcPackage = { identifier: string; product: StoreProduct };
type Offerings = { current: { availablePackages: RcPackage[] } | null };
type PurchasesModule = {
  configure: (opts: { apiKey: string; appUserID?: string | null }) => void;
  logIn: (appUserID: string) => Promise<{ customerInfo: CustomerInfo }>;
  logOut: () => Promise<CustomerInfo>;
  getCustomerInfo: () => Promise<CustomerInfo>;
  getOfferings: () => Promise<Offerings>;
  purchasePackage: (pkg: RcPackage) => Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases: () => Promise<CustomerInfo>;
  addCustomerInfoUpdateListener: (cb: (info: CustomerInfo) => void) => void;
  removeCustomerInfoUpdateListener: (cb: (info: CustomerInfo) => void) => boolean | void;
};

let cached: PurchasesModule | null | undefined;
let configured = false;

/** The RevenueCat SDK, or null in Expo Go, on web, in a dev build made before it was added, or with no API key. */
function loadPurchases(): PurchasesModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "ios" || !revenueCatIosKey()) return cached;
  try {
    const present = Boolean(TurboModuleRegistry.get("RNPurchases") ?? NativeModules.RNPurchases);
    if (!present) return cached;
    const mod = require("react-native-purchases") as { default?: PurchasesModule } & PurchasesModule;
    const api = mod.default ?? mod;
    if (typeof api?.configure !== "function") return cached;
    cached = api;
  } catch (e) {
    console.warn("[ctplus] purchases unavailable:", e instanceof Error ? e.message : String(e));
  }
  return cached;
}

export function purchasesAvailable(): boolean {
  return loadPurchases() != null;
}

export function hasCtPlus(info: CustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements?.active?.[CTPLUS_ENTITLEMENT_ID]);
}

/** Identifies the player to RevenueCat by their Supabase user id. Returns their current entitlement. */
export async function identify(userId: string): Promise<boolean> {
  const api = loadPurchases();
  const key = revenueCatIosKey();
  if (!api || !key) return false;
  if (!configured) {
    api.configure({ apiKey: key, appUserID: userId });
    configured = true;
    return hasCtPlus(await api.getCustomerInfo());
  }
  const { customerInfo } = await api.logIn(userId);
  return hasCtPlus(customerInfo);
}

export async function forget(): Promise<void> {
  const api = loadPurchases();
  if (!api || !configured) return;
  try {
    await api.logOut();
  } catch {
    // Already anonymous.
  }
}

export function onEntitlementChange(cb: (isPlus: boolean) => void): () => void {
  const api = loadPurchases();
  if (!api) return () => {};
  const listener = (info: CustomerInfo) => cb(hasCtPlus(info));
  api.addCustomerInfoUpdateListener(listener);
  return () => {
    api.removeCustomerInfoUpdateListener(listener);
  };
}

/** One purchasable plan from the current offering. `price` and `priceString` are the store's own. */
export type CtPlusPlan = {
  id: PlanId;
  productId: string;
  priceString: string;
  price: number;
  currencyCode: string;
  /** The RevenueCat package, handed back to purchasePackage. */
  pkg: unknown;
};

export type OfferingResult = { ok: true; plans: Partial<Record<PlanId, CtPlusPlan>> } | { ok: false };

/**
 * The monthly ($rc_monthly) and annual ($rc_annual) packages of the RevenueCat current offering.
 * Fails (ok false) when the SDK is unavailable, the request errors or the offering has neither package.
 */
export async function loadOffering(): Promise<OfferingResult> {
  const api = loadPurchases();
  if (!api) return { ok: false };
  try {
    const offerings = await api.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const plans: Partial<Record<PlanId, CtPlusPlan>> = {};
    for (const id of PLAN_IDS) {
      const pkg = packages.find((p) => p.identifier === PLAN_META[id].packageId);
      if (!pkg) continue;
      plans[id] = {
        id,
        productId: pkg.product.identifier,
        priceString: pkg.product.priceString,
        price: pkg.product.price,
        currencyCode: pkg.product.currencyCode,
        pkg,
      };
    }
    return plans.monthly || plans.annual ? { ok: true, plans } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type PurchaseOutcome = "purchased" | "cancelled" | "unavailable" | "failed";

export async function purchasePlan(plan: CtPlusPlan): Promise<PurchaseOutcome> {
  const api = loadPurchases();
  if (!api) return "unavailable";
  try {
    const { customerInfo } = await api.purchasePackage(plan.pkg as RcPackage);
    return hasCtPlus(customerInfo) ? "purchased" : "failed";
  } catch (e) {
    return (e as { userCancelled?: boolean })?.userCancelled ? "cancelled" : "failed";
  }
}

export async function restore(): Promise<boolean> {
  const api = loadPurchases();
  if (!api) return false;
  try {
    return hasCtPlus(await api.restorePurchases());
  } catch {
    return false;
  }
}
