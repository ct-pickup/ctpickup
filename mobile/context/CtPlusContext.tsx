import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { CTPLUS_ENABLED } from "@/lib/ctplus/config";
import type { PlanId } from "@/lib/ctplus/plans";
import {
  forget,
  identify,
  loadOffering,
  onEntitlementChange,
  purchasePlan,
  purchasesAvailable,
  restore,
  type CtPlusPlan,
  type PurchaseOutcome,
} from "@/lib/ctplus/purchases";

type CtPlusValue = {
  /** CTPLUS_ENABLED. When false nothing else here does anything. */
  enabled: boolean;
  /** Entitlement from RevenueCat on this device. Never read by the free share card. */
  isPlus: boolean;
  /** Purchases can run (iOS dev/production build with the SDK and a key). False in Expo Go. */
  canPurchase: boolean;
  /** The plans in the RevenueCat current offering, with the store's prices. Empty until loaded. */
  plans: Partial<Record<PlanId, CtPlusPlan>>;
  /** "loading" until the offering answers; "unavailable" when it failed or has no packages. */
  offering: "loading" | "ready" | "unavailable";
  reloadOffering: () => Promise<void>;
  busy: boolean;
  purchase: (plan: PlanId) => Promise<PurchaseOutcome>;
  restorePurchases: () => Promise<boolean>;
};

const OFF: CtPlusValue = {
  enabled: false,
  isPlus: false,
  canPurchase: false,
  plans: {},
  offering: "unavailable",
  reloadOffering: async () => {},
  busy: false,
  purchase: async () => "unavailable",
  restorePurchases: async () => false,
};

const CtPlusContext = createContext<CtPlusValue>(OFF);

export function CtPlusProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [isPlus, setIsPlus] = useState(false);
  const [plans, setPlans] = useState<Partial<Record<PlanId, CtPlusPlan>>>({});
  const [offering, setOffering] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);

  const reloadOffering = useCallback(async () => {
    setOffering("loading");
    const r = await loadOffering();
    setPlans(r.ok ? r.plans : {});
    setOffering(r.ok ? "ready" : "unavailable");
  }, []);

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
      const result = await loadOffering();
      if (cancelled) return;
      setIsPlus(plus);
      setPlans(result.ok ? result.plans : {});
      setOffering(result.ok ? "ready" : "unavailable");
    })();
    const off = CTPLUS_ENABLED ? onEntitlementChange(setIsPlus) : () => {};
    return () => {
      cancelled = true;
      off();
    };
  }, [userId]);

  const purchase = useCallback(
    async (planId: PlanId) => {
      const plan = plans[planId];
      if (!plan) return "unavailable" as const;
      setBusy(true);
      try {
        const outcome = await purchasePlan(plan);
        if (outcome === "purchased") setIsPlus(true);
        return outcome;
      } finally {
        setBusy(false);
      }
    },
    [plans],
  );

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
            plans,
            offering,
            reloadOffering,
            busy,
            purchase,
            restorePurchases,
          }
        : OFF,
    [isPlus, plans, offering, reloadOffering, busy, purchase, restorePurchases],
  );

  return <CtPlusContext.Provider value={value}>{children}</CtPlusContext.Provider>;
}

export function useCtPlus(): CtPlusValue {
  return useContext(CtPlusContext);
}
