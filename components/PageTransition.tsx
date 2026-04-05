"use client";

import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { RouteBrandOverlay } from "@/components/RouteBrandOverlay";
import { TransitionNavContext } from "@/components/TransitionNavContext";

function shouldSkipOverlayMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Run after the next two paints so the portaled overlay can appear before the route swaps. */
function scheduleNavigation(run: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

function isInternalNavClick(
  anchor: HTMLAnchorElement,
  currentNavKey: string,
): boolean {
  if (anchor.getAttribute("download") != null) return false;
  if (anchor.target === "_blank") return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return false;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.origin);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  const next = `${url.pathname}${url.search}`;
  const cur = currentNavKey.split("#")[0] ?? currentNavKey;
  return next !== cur;
}

function PageTransitionInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const navKey =
    searchParams.size > 0
      ? `${pathname}?${searchParams.toString()}`
      : pathname;

  const routeOverlayPrev = useRef<string | null>(null);
  const latestOverlaySession = useRef(0);
  const navKeyRef = useRef(navKey);
  navKeyRef.current = navKey;
  const pendingClickNav = useRef(false);

  const [overlaySession, setOverlaySession] = useState<number | null>(null);

  const handleOverlayComplete = useCallback((session: number) => {
    if (session === latestOverlaySession.current) {
      setOverlaySession(null);
    }
  }, []);

  const navigateWithTransition = useCallback(
    (href: string) => {
      if (typeof window === "undefined") return;
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) {
        window.location.href = href;
        return;
      }
      const next = `${url.pathname}${url.search}${url.hash}`;
      const cur = navKeyRef.current.split("#")[0] ?? navKeyRef.current;
      if (next.split("#")[0] === cur) return;

      if (shouldSkipOverlayMotion()) {
        router.push(next);
        return;
      }

      pendingClickNav.current = true;
      flushSync(() => {
        latestOverlaySession.current += 1;
        setOverlaySession(latestOverlaySession.current);
      });
      scheduleNavigation(() => router.push(next));
    },
    [router]
  );

  const transitionNavValue = useMemo(
    () => ({ navigateWithTransition }),
    [navigateWithTransition]
  );

  /**
   * Single source of truth for showing the overlay: every distinct `navKey` bumps once.
   * - First load (including `/`): same path as later navigations (no “initial skip”).
   * - `pendingClickNav`: link/`navigateWithTransition` already bumped + `router.push`; absorb this key change only.
   * - `routeOverlayPrev.current === newKey`: dedupes layout vs `popstate` / strict re-runs.
   */
  const applyNavKeyChange = useCallback((newKey: string) => {
    if (routeOverlayPrev.current === newKey) return;

    routeOverlayPrev.current = newKey;

    if (shouldSkipOverlayMotion()) return;

    if (pendingClickNav.current) {
      pendingClickNav.current = false;
      return;
    }

    latestOverlaySession.current += 1;
    setOverlaySession(latestOverlaySession.current);
  }, []);

  useLayoutEffect(() => {
    applyNavKeyChange(navKey);
  }, [navKey, applyNavKeyChange]);

  /** Browser back/forward: `popstate` fires; pair with pathname+search key so overlay runs when React is in sync with `history`. */
  useEffect(() => {
    const onPopState = () => {
      queueMicrotask(() => {
        const key = `${window.location.pathname}${window.location.search}`;
        applyNavKeyChange(key);
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyNavKeyChange]);

  /** Internal links: overlay first, then `router.push` (avoids relying on default click after `flushSync`). */
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      const a = el.closest("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (!isInternalNavClick(a, navKeyRef.current)) return;
      if (shouldSkipOverlayMotion()) return;

      e.preventDefault();

      const url = new URL(a.href, window.location.origin);
      const href = `${url.pathname}${url.search}${url.hash}`;

      pendingClickNav.current = true;

      flushSync(() => {
        latestOverlaySession.current += 1;
        setOverlaySession(latestOverlaySession.current);
      });

      scheduleNavigation(() => router.push(href));
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [router]);

  return (
    <TransitionNavContext.Provider value={transitionNavValue}>
      <div key={navKey}>{children}</div>
      {overlaySession !== null ? (
        <RouteBrandOverlay
          key={overlaySession}
          session={overlaySession}
          onComplete={handleOverlayComplete}
        />
      ) : null}
    </TransitionNavContext.Provider>
  );
}

/**
 * App Router template shell: branded overlay on every in-app URL identity change.
 * - `applyNavKeyChange` runs for initial `navKey`, `useLayoutEffect` updates, and `popstate` (deduped by key).
 * - Clicks / `navigateWithTransition`: `flushSync` bump + `router.push`, then `pendingClickNav` avoids a second bump.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<>{children}</>}>
      <PageTransitionInner>{children}</PageTransitionInner>
    </Suspense>
  );
}
