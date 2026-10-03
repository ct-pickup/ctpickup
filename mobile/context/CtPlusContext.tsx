import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { CTPLUS_ENABLED, CTPLUS_FALLBACK_PRICE } from "@/lib/ctplus/config";
import {
  fetchPriceString,
  forget,
  identify,
  onEntitlementChange,
  purchaseAnnual,
  purchasesAvailable,
  restore,
  type PurchaseOutcome,
} from "@/lib/ctplus/purchases";

type CtPlusValue = {
  /** CTPLUS_ENABLED. When false nothing else here does anything. */
  enabled: boolean;
  /** Entitlement from RevenueCat on this device. Never read by the free share card. */
  isPlus: boolean;
  /** Purchases can run (iOS dev/production build with the SDK and a key). False in Expo Go. */
  canPurchase: boolean;
  priceLabel: string;
  busy: boolean;
  purchase: () => Promise<PurchaseOutcome>;
  restorePurchases: () => Promise<boolean>;
};

const OFF: CtPlusValue = {
  enabled: false,
  isPlus: false,
  canPurchase: false,
  priceLabel: CTPLUS_FALLBACK_PRICE,
  busy: false,
  purchase: async () => "unavailable",
  restorePurchases: async () => false,
};

const CtPlusContext = createContext<CtPlusValue>(OFF);

export function CtPlusProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [isPlus, setIsPlus] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CTPLUS_ENABLED) return;
    let cancelled = false;
    void (async () => {
      if (!userId) {
        await forget();
        if (!cancelled) setIsPlus(false);
        return;
      }
      const plus = await identify(userId).catch(() => false);
      const label = await fetchPriceString();
      if (cancelled) return;
      setIsPlus(plus);
      setPrice(label);
    })();
    const off = CTPLUS_ENABLED ? onEntitlementChange(setIsPlus) : () => {};
    return () => {
      cancelled = true;
      off();
    };
  }, [userId]);

  const purchase = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await purchaseAnnual();
      if (outcome === "purchased") setIsPlus(true);
      return outcome;
    } finally {
      setBusy(false);
    }
  }, []);

  const restorePurchases = useCallback(async () => {
    setBusy(true);
    try {
      const plus = await restore();
      if (plus) setIsPlus(true);
      return plus;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<CtPlusValue>(
    () =>
      CTPLUS_ENABLED
        ? {
            enabled: true,
            isPlus,
            canPurchase: purchasesAvailable(),
            priceLabel: price ?? CTPLUS_FALLBACK_PRICE,
            busy,
            purchase,
            restorePurchases,
          }
        : OFF,
    [isPlus, price, busy, purchase, restorePurchases],
  );

  return <CtPlusContext.Provider value={value}>{children}</CtPlusContext.Provider>;
}

export function useCtPlus(): CtPlusValue {
  return useContext(CtPlusContext);
}
