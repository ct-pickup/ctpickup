"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  MOBILE_PICKUP_CHECKOUT_CANCEL_URL,
  MOBILE_PICKUP_CHECKOUT_SUCCESS_URL,
  isMobileWebUserAgent,
} from "@/lib/pickup/stripeCheckoutUrls";

export default function PickupCheckoutReturnPage() {
  const searchParams = useSearchParams();
  const paid = searchParams.get("paid") === "1";
  const canceled = searchParams.get("canceled") === "1";

  const deepLink = useMemo(() => {
    if (paid) return MOBILE_PICKUP_CHECKOUT_SUCCESS_URL;
    if (canceled) return MOBILE_PICKUP_CHECKOUT_CANCEL_URL;
    return MOBILE_PICKUP_CHECKOUT_SUCCESS_URL;
  }, [paid, canceled]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!isMobileWebUserAgent(navigator.userAgent)) return;
    window.location.replace(deepLink);
  }, [deepLink]);

  const title = paid ? "Payment complete" : canceled ? "Checkout canceled" : "Returning to Competitive Together";

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-h2 font-serif font-bold text-ink">{title}</h1>
      <p className="text-small text-muted">
        {paid
          ? "If you paid in the Competitive Together app, switch back to the app to see your updated status."
          : canceled
            ? "You can return to the app and try again when you're ready."
            : "You can close this tab or open the Competitive Together app."}
      </p>
      <Link href="/pickup" className="text-small font-semibold text-pitch-text underline">
        Continue on the website
      </Link>
    </main>
  );
}
