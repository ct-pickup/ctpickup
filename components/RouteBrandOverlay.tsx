"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeHeroBrand } from "@/components/home/HomeHeroBrand";

/**
 * Longest entrance finishes ≈ 140ms delay + 660ms tagline animation — hold starts after brand is settled.
 * Keep in sync with `ct-route-brand-tag` in globals.css.
 */
export const ROUTE_OVERLAY_SETTLE_MS = 820;

/** Readable hold at full strength before exit sequence. */
export const ROUTE_OVERLAY_HOLD_MS = 1120;

/**
 * Exit duration — must match `.ct-route-overlay--exiting` keyframes in globals.css.
 */
export const ROUTE_OVERLAY_EXIT_MS = 420;

type Props = {
  session: number;
  onComplete: (session: number) => void;
};

/**
 * Full-screen branded shell during navigations. Portals to `document.body` so
 * `position: fixed` is never trapped by a parent stacking context.
 */
export function RouteBrandOverlay({ session, onComplete }: Props) {
  const [exiting, setExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    const tExit = window.setTimeout(() => {
      if (!cancelled) setExiting(true);
    }, ROUTE_OVERLAY_SETTLE_MS + ROUTE_OVERLAY_HOLD_MS);
    const tDone = window.setTimeout(() => {
      if (!cancelled) onCompleteRef.current(session);
    }, ROUTE_OVERLAY_SETTLE_MS + ROUTE_OVERLAY_HOLD_MS + ROUTE_OVERLAY_EXIT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(tExit);
      window.clearTimeout(tDone);
    };
  }, [session]);

  const layer = (
    <div
      className={[
        "ct-route-overlay fixed inset-0 flex flex-col items-center justify-center bg-[var(--bg)] text-center",
        "shadow-[inset_0_0_100px_rgba(0,0,0,0.45)]",
        exiting ? "ct-route-overlay--exiting pointer-events-none" : "",
      ].join(" ")}
      style={{ zIndex: 2147483646 }}
      aria-hidden
    >
      <HomeHeroBrand
        logoAlt=""
        titleAs="div"
        stackClassName="ct-route-overlay-brand"
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(layer, document.body);
}
