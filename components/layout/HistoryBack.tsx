"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { useTransitionNav } from "@/components/TransitionNavContext";

const defaultClassName =
  "shrink-0 cursor-pointer border-0 bg-transparent p-0 text-inherit font-inherit text-sm text-white/75 transition hover:text-white";

type HistoryBackProps = {
  /** When browser history does not yield a safe in-app “previous” step. */
  fallbackHref?: string;
  label?: string;
  className?: string;
  /** Paths where the control is hidden (default: homepage only). */
  hideOnPaths?: string[];
};

/**
 * Uses session history when it likely reflects an in-app previous page;
 * otherwise navigates to `fallbackHref`.
 */
export function HistoryBack({
  fallbackHref = "/",
  label = "Back",
  className,
  hideOnPaths = ["/"],
}: HistoryBackProps) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const transitionNav = useTransitionNav();

  const handleBack = useCallback(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    let ref = "";
    try {
      ref = document.referrer;
    } catch {
      ref = "";
    }
    const fromSameOrigin = ref !== "" && ref.startsWith(origin);

    if (fromSameOrigin) {
      router.back();
      return;
    }

    // In-app client navigations often leave referrer empty; history stack still works.
    if (ref === "" && window.history.length > 1) {
      router.back();
      return;
    }

    if (transitionNav) {
      transitionNav.navigateWithTransition(fallbackHref);
    } else {
      router.push(fallbackHref);
    }
  }, [router, fallbackHref, transitionNav]);

  if (hideOnPaths.includes(pathname)) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={className ?? defaultClassName}
    >
      {label}
    </button>
  );
}
