"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HistoryBack } from "@/components/layout";
import { safeWaiverReturnTo } from "@/lib/waiver/safeReturnTo";

const RETURN_LABELS: Record<string, string> = {
  "/signup": "Back to sign up",
  "/onboarding": "Back to profile setup",
};

/**
 * Reads ?returnTo= for HistoryBack when referrer/history is empty (common on mobile).
 */
export function LiabilityWaiverReturnBack() {
  const searchParams = useSearchParams();
  const returnTo = safeWaiverReturnTo(searchParams.get("returnTo"));
  const fallbackHref = returnTo ?? "/";

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <HistoryBack fallbackHref={fallbackHref} />
      {returnTo ? (
        <Link
          href={returnTo}
          className="text-sm font-medium text-white/80 underline-offset-4 transition hover:text-white hover:underline sm:ml-1"
        >
          {RETURN_LABELS[returnTo] ?? "Continue where you left off"}
        </Link>
      ) : null}
    </div>
  );
}
