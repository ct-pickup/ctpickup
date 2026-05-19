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

  const title = paid ? "Payment complete" : canceled ? "Checkout canceled" : "Returning to CT Pickup";

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      <p className="text-sm text-white/65">
        {paid
          ? "If you paid in the CT Pickup app, switch back to the app to see your updated status."
          : canceled
            ? "You can return to the app and try again when you're ready."
            : "You can close this tab or open the CT Pickup app."}
      </p>
      <Link href="/pickup" className="text-sm font-semibold text-lime-300 underline">
        Continue on the website
      </Link>
    </main>
  );
}
