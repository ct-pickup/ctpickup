/* eslint-disable @typescript-eslint/no-require-imports -- react-native-purchases needs native code, required lazily so Expo Go still loads */
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

import { CTPLUS_ENTITLEMENT_ID, CTPLUS_PRODUCT_ID, revenueCatIosKey } from "@/lib/ctplus/config";

type CustomerInfo = { entitlements: { active: Record<string, unknown> } };
type StoreProduct = { identifier: string; priceString: string };
type PurchasesModule = {
  configure: (opts: { apiKey: string; appUserID?: string | null }) => void;
  logIn: (appUserID: string) => Promise<{ customerInfo: CustomerInfo }>;
  logOut: () => Promise<CustomerInfo>;
  getCustomerInfo: () => Promise<CustomerInfo>;
  getProducts: (ids: string[]) => Promise<StoreProduct[]>;
  purchaseStoreProduct: (product: StoreProduct) => Promise<{ customerInfo: CustomerInfo }>;
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

/** The store's localized price for the annual product, e.g. "$9.99". */
export async function fetchPriceString(): Promise<string | null> {
  const api = loadPurchases();
  if (!api) return null;
  try {
    const [product] = await api.getProducts([CTPLUS_PRODUCT_ID]);
    return product?.priceString ?? null;
  } catch {
    return null;
  }
}

export type PurchaseOutcome = "purchased" | "cancelled" | "unavailable" | "failed";

export async function purchaseAnnual(): Promise<PurchaseOutcome> {
  const api = loadPurchases();
  if (!api) return "unavailable";
  try {
    const [product] = await api.getProducts([CTPLUS_PRODUCT_ID]);
    if (!product) return "unavailable";
    const { customerInfo } = await api.purchaseStoreProduct(product);
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
