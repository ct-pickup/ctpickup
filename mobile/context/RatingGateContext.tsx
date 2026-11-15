import { useRouter } from "expo-router";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { RatingRequiredSheet } from "@/components/rating/RatingRequiredSheet";
import { ballotHref } from "@/lib/pendingRatingCore";
import { parseRatingRequired, type RatingRequired } from "@shared/ratingGate";

type RatingGateValue = {
  /**
   * Opens the "Rate your last game first" sheet when an API response is the 409 rating_required answer. Returns true when it
   * handled the response, so the caller stops there and shows no error of its own.
   */
  handleRatingRequired: (status: number, json: unknown) => boolean;
};

const Ctx = createContext<RatingGateValue | undefined>(undefined);

export function RatingGateProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [request, setRequest] = useState<RatingRequired | null>(null);

  const handleRatingRequired = useCallback((status: number, json: unknown) => {
    const r = parseRatingRequired(status, json);
    if (!r) return false;
    setRequest(r);
    return true;
  }, []);

  const goToBallot = useCallback(() => {
    const runId = request?.run_id;
    setRequest(null);
    if (runId) (router.push as (href: string) => void)(ballotHref(runId));
  }, [request, router]);

  const value = useMemo(() => ({ handleRatingRequired }), [handleRatingRequired]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <RatingRequiredSheet visible={request !== null} onGo={goToBallot} onClose={() => setRequest(null)} />
    </Ctx.Provider>
  );
}

export function useRatingGate(): RatingGateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRatingGate must be used within RatingGateProvider");
  return ctx;
}
