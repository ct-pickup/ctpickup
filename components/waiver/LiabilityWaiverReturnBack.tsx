"use client";

import Link from "next/link";
import { HistoryBack } from "@/components/layout";

function returnToLabel(returnTo: string): string {
  if (returnTo.startsWith("/signup")) return "Back to sign up";
  if (returnTo.startsWith("/onboarding")) return "Back to profile setup";
  return "Continue where you left off";
}

export type LiabilityWaiverReturnBackProps = {
  /** Resolved from `?returnTo=` on the server (open-redirect safe). */
  returnTo?: string | null;
};

/**
 * Back navigation for the waiver page. `returnTo` comes from the page’s
 * `searchParams` so we avoid client `useSearchParams()` and prerender bailout.
 */
export function LiabilityWaiverReturnBack({
  returnTo = null,
}: LiabilityWaiverReturnBackProps) {
  const fallbackHref = returnTo ?? "/";

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <HistoryBack fallbackHref={fallbackHref} />
      {returnTo ? (
        <Link
          href={returnTo}
          className="text-small font-medium text-ink underline-offset-4 transition hover:text-ink hover:underline sm:ml-1"
        >
          {returnToLabel(returnTo)}
        </Link>
      ) : null}
    </div>
  );
}
