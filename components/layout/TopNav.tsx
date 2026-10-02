"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  APP_HOME_URL,
  HUB_NAV_ABOUT,
  HUB_NAV_PICKUP,
  HUB_NAV_TOURNAMENT,
  hubDropdownActive,
  navItemActive,
} from "@/lib/siteNav";
import { HistoryBack } from "./HistoryBack";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import {
  readHasEverSignedUpBrowser,
  signupIntentForProtectedPath,
  signupUrlForProtectedNavFirstVisit,
} from "@/lib/auth/signupIntent";
import { Monogram } from "@/components/brand/Monogram";
import { Wordmark } from "@/components/brand/Wordmark";
import { PRODUCT_NAME } from "@/lib/brand";

type NavMenu = "pickup" | "tournaments" | "about" | null;

/** Back in the top bar only on these hubs (exact path or nested). */
const TOP_NAV_BACK_PREFIXES = ["/pickup", "/about", "/tournament-info"] as const;

/** Focused flows: do not render the primary nav bar (exact path or nested). */
const TOP_NAV_HIDDEN_PREFIXES = [
  "/terms",
  "/privacy",
  "/liability-waiver",
  "/profile",
] as const;

function topNavShowsHistoryBack(pathname: string) {
  return TOP_NAV_BACK_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function shouldHideTopNav(pathname: string) {
  return TOP_NAV_HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function MobileChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden
      className="flex h-[44px] w-8 shrink-0 items-center justify-center text-body font-light leading-none tabular-nums text-muted antialiased"
    >
      {expanded ? "\u2212" : "+"}
    </span>
  );
}

/** Smooth height expand/collapse without changing open/close logic. */
function MobileAccordionPanel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${ open ? "grid-rows-[1fr]" : "grid-rows-[0fr]" }`}
    >
      <div className="relative z-[1] min-h-0 overflow-hidden [touch-action:manipulation]">{children}</div>
    </div>
  );
}

/**
 * Mobile menu: portal only mounts when `open` is true.
 * Sheet and dimmer are stacked vertically (flex column) so they never overlap — avoids WebKit eating taps on nested links.
 */
function MobileNavSheetPortal({
  open,
  overlayTopPx,
  onClose,
  children,
}: {
  open: boolean;
  overlayTopPx: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  const topPx = Math.max(48, Math.round(Number.isFinite(overlayTopPx) ? overlayTopPx : 48));

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-[305] flex flex-col lg:hidden"
      style={{ top: topPx }}
    >
      <div
        id="mobile-nav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        className="relative z-10 min-h-0 w-full shrink-0 overflow-y-auto overscroll-y-contain border-b border-line bg-canvas [touch-action:manipulation]"
        style={{
          maxHeight: `calc(100dvh - ${topPx}px)`,
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      <div
        role="presentation"
        aria-hidden
        className="relative z-0 min-h-0 flex-1 bg-scrim backdrop-blur-[3px] [touch-action:manipulation]"
        onClick={onClose}
      />
    </div>,
    document.body,
  );
}

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-muted"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MobileMenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="text-ink"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {open ? (
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path d="M5 7h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M5 12h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M5 17h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function TopNav({
  brandHref = "/",
  homeHref = "/",
  fallbackHref = "/",
  backLabel = "Back",
  rightSlot,
  profileSection,
  showPrimaryNav = true,
  gateProtectedNav = true,
  className = "",
  innerClassName = "",
}: {
  /** Logo wordmark target */
  brandHref?: string;
  /** Top-level Home link (default: `/`) */
  homeHref?: string;
  /** When history has no in-app previous step. */
  fallbackHref?: string;
  backLabel?: string;
  /** Replaces profile when set (e.g. Help); Back (when shown) appears before this slot. */
  rightSlot?: React.ReactNode;
  /** Right-side profile chip like the dashboard. */
  profileSection?: { displayName: string };
  /** Hub links (Home, Pickup, Tournaments, …). `/help` passes `false` for guests after auth is known. */
  showPrimaryNav?: boolean;
  /** When true, logged-out clicks to Pickup/Tournaments/Esports go to signup (first visit) or `/login?next=...` (returning). */
  gateProtectedNav?: boolean;
  className?: string;
  innerClassName?: string;
}) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [openMenu, setOpenMenu] = useState<NavMenu>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [overlayTopPx, setOverlayTopPx] = useState(0);
  const navRef = useRef<HTMLDivElement>(null);
  const mobileBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gateProtectedNav) {
      setAuthed(true);
      return;
    }
    if (!isReady) return;
    if (!supabase) {
      setAuthed(false);
      return;
    }
    const client = supabase;
    let alive = true;
    void (async () => {
      const { data } = await client.auth.getUser();
      if (!alive) return;
      setAuthed(!!data.user);
    })();
    const { data: sub } = client.auth.onAuthStateChange((_evt, session) => {
      setAuthed(!!session?.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [gateProtectedNav, supabase, isReady]);

  const isProtectedHref = useCallback((href: string) => {
    const pathOnly = (href.split("?")[0] || "/").replace(/\/+$/, "") || "/";
    if (pathOnly === "/pickup" || pathOnly.startsWith("/pickup/")) return true;
    if (pathOnly === "/tournament" || pathOnly.startsWith("/tournament/")) return true;
    if (pathOnly === "/esports" || pathOnly.startsWith("/esports/")) {
      // Public browse: hub, list, and tournament detail. Registration / consent flows stay gated.
      if (pathOnly === "/esports" || pathOnly === "/esports/tournaments") return false;
      if (/^\/esports\/tournaments\/[^/]+$/.test(pathOnly)) return false;
      return true;
    }
    return false;
  }, []);

  const pushWithAuthGate = useCallback(
    (href: string) => {
      if (!gateProtectedNav) {
        router.push(href);
        return;
      }
      if (authed === false && isProtectedHref(href)) {
        const next = safeNextPath(href) ?? "/";
        const intent = signupIntentForProtectedPath(href);
        if (intent && !readHasEverSignedUpBrowser()) {
          router.push(signupUrlForProtectedNavFirstVisit(intent));
          return;
        }
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      router.push(href);
    },
    [gateProtectedNav, authed, isProtectedHref, router],
  );

  useLayoutEffect(() => {
    setOpenMenu(null);
    setMobileSheetOpen(false);
  }, [pathname]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!openMenu) return;
      // Mobile accordion lives in a portal; never run desktop "outside click" while sheet is open.
      if (mobileSheetOpen) return;
      const target = e.target as Node;
      const el = navRef.current;
      if (el?.contains(target)) return;
      const sheet =
        typeof document !== "undefined" ? document.getElementById("mobile-nav-sheet") : null;
      if (sheet?.contains(target)) return;
      setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu, mobileSheetOpen]);

  const closeMobileSheet = useCallback(() => setMobileSheetOpen(false), []);

  useLayoutEffect(() => {
    if (!mobileSheetOpen || !showPrimaryNav) return;
    function updateOverlayTop() {
      const el = mobileBarRef.current;
      if (!el) return;
      setOverlayTopPx(Math.max(48, el.getBoundingClientRect().bottom));
    }
    updateOverlayTop();
    window.addEventListener("resize", updateOverlayTop);
    window.addEventListener("scroll", updateOverlayTop, true);
    return () => {
      window.removeEventListener("resize", updateOverlayTop);
      window.removeEventListener("scroll", updateOverlayTop, true);
    };
  }, [mobileSheetOpen, showPrimaryNav]);

  useEffect(() => {
    if (!mobileSheetOpen || !showPrimaryNav) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileSheetOpen, showPrimaryNav]);

  useEffect(() => {
    if (!showPrimaryNav) setMobileSheetOpen(false);
  }, [showPrimaryNav]);

  useEffect(() => {
    if (!mobileSheetOpen || !showPrimaryNav) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobileSheet();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSheetOpen, showPrimaryNav, closeMobileSheet]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    function onMq() {
      if (mq.matches) setMobileSheetOpen(false);
    }
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  if (shouldHideTopNav(pathname)) return null;

  function toggle(menu: Exclude<NavMenu, null>) {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  const pickupOpen = openMenu === "pickup";
  const tournamentsOpen = openMenu === "tournaments";
  const aboutOpen = openMenu === "about";

  const linkBase =
    "shrink-0 whitespace-nowrap text-caption font-medium transition xl:text-small";
  const linkIdle = `${linkBase}text-ink hover:text-ink`;
  const linkActive = `${linkBase}text-ink`;

  const trainingOn = navItemActive(pathname, "/training");
  const u23On = navItemActive(pathname, "/u23");
  const esportsOn = navItemActive(pathname, "/esports");
  const guidanceOn = navItemActive(pathname, "/guidance");
  const homeBasePath = (homeHref.split("?")[0] || "/").replace(/\/$/, "") || "/";
  const homeOn =
    homeBasePath === "/"
      ? pathname === "/"
      : pathname === homeBasePath || pathname.startsWith(`${homeBasePath}/`);

  const backClass =
    "shrink-0 text-small text-muted transition hover:text-ink inline-flex items-center justify-center min-h-[44px] rounded-button px-2 -mx-0.5 active:bg-overlay-subtle lg:min-h-0 lg:rounded-none lg:px-0 lg:mx-0 lg:active:bg-transparent";

  /** Compact back control for the mobile header row only */
  const mobileHeaderBackClass =
    "shrink-0 text-caption font-medium text-muted transition hover:text-ink inline-flex items-center justify-center min-h-10 rounded-button px-2.5 active:bg-overlay";

  const showHistoryBack = topNavShowsHistoryBack(pathname);

  const mobileRowBase =
    "touch-manipulation flex min-h-[44px] w-full items-center rounded-[6px] pl-1.5 pr-1.5 text-left text-body font-medium leading-none transition-colors active:bg-overlay-subtle";

  const mobileNavItem = (active: boolean) =>
    [
      mobileRowBase,
      active ? "text-ink" : "text-ink hover:bg-overlay-subtle hover:text-ink",
    ].join("  ");

  const mobileAccordionBtn = (active: boolean) =>
    [
      "touch-manipulation flex min-h-[44px] w-full items-center rounded-[6px] pl-1.5 pr-0 text-left text-body font-medium leading-none transition-colors active:bg-overlay-subtle",
      "justify-between gap-1",
      active ? "text-ink" : "text-ink hover:bg-overlay-subtle hover:text-ink",
    ].join("  ");

  const mobileSubLink =
    "relative z-[2] flex min-h-[36px] w-full items-center border-l border-line py-[7px] pl-3.5 pr-1.5 text-caption font-normal leading-[1.4] text-muted transition-colors [touch-action:manipulation] hover:bg-overlay-subtle hover:text-muted active:bg-overlay-subtle";

  const profilePill = profileSection ? (
    <div className="flex shrink-0 items-center gap-2 rounded-pill border border-line bg-overlay px-3 py-1.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-pill border border-line">
        <UserIcon />
      </div>
      <div className="max-w-[140px] truncate text-small font-medium text-ink">
        {profileSection.displayName}
      </div>
    </div>
  ) : null;

  const desktopRight = (
    <div className="hidden shrink-0 items-center gap-2 lg:flex lg:gap-3">
      {showHistoryBack ? (
        <HistoryBack
          fallbackHref={fallbackHref}
          label={backLabel}
          className={backClass}
        />
      ) : null}
      {rightSlot ?? profilePill}
    </div>
  );

  /** Sheet closes via `useLayoutEffect` on `pathname` — avoid onClick close that unmounts portal before client nav. */
  const mobileSheetNav = showPrimaryNav ? (
    <nav aria-label="Primary" className="flex flex-col px-3 pb-8 pt-2">
      <Link
        href={homeHref}
        className={mobileNavItem(homeOn)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          pushWithAuthGate(homeHref);
        }}
      >
        Home
      </Link>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={pickupOpen}
          onClick={() => toggle("pickup")}
          className={mobileAccordionBtn(
            hubDropdownActive(pathname, "pickup") || pickupOpen,
          )}
        >
          <span className="min-w-0 flex-1">Pickup Games</span>
          <MobileChevron expanded={pickupOpen} />
        </button>
        <MobileAccordionPanel open={pickupOpen}>
          <div className="ml-2 flex flex-col pb-0.5 pt-0.5">
            {HUB_NAV_PICKUP.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={mobileSubLink}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate(item.href);
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </MobileAccordionPanel>
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={tournamentsOpen}
          onClick={() => toggle("tournaments")}
          className={mobileAccordionBtn(
            hubDropdownActive(pathname, "tournament") || tournamentsOpen,
          )}
        >
          <span className="min-w-0 flex-1">Tournaments</span>
          <MobileChevron expanded={tournamentsOpen} />
        </button>
        <MobileAccordionPanel open={tournamentsOpen}>
          <div className="ml-2 flex flex-col pb-0.5 pt-0.5">
            {HUB_NAV_TOURNAMENT.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={mobileSubLink}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate(item.href);
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </MobileAccordionPanel>
      </div>

      <Link
        href="/training"
        className={mobileNavItem(trainingOn)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          pushWithAuthGate("/training");
        }}
      >
        Training
      </Link>

      <Link
        href="/u23"
        className={mobileNavItem(u23On)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          pushWithAuthGate("/u23");
        }}
      >
        U23
      </Link>

      <Link
        href="/esports"
        className={mobileNavItem(esportsOn)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          pushWithAuthGate("/esports");
        }}
      >
        Esports
      </Link>

      <Link
        href="/guidance"
        className={mobileNavItem(guidanceOn)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          pushWithAuthGate("/guidance");
        }}
      >
        Guidance
      </Link>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={aboutOpen}
          onClick={() => toggle("about")}
          className={mobileAccordionBtn(
            hubDropdownActive(pathname, "about") || aboutOpen,
          )}
        >
          <span className="min-w-0 flex-1">About</span>
          <MobileChevron expanded={aboutOpen} />
        </button>
        <MobileAccordionPanel open={aboutOpen}>
          <div className="ml-2 flex flex-col pb-0.5 pt-0.5">
            {HUB_NAV_ABOUT.map((item) => (
              <Link key={item.href} href={item.href} className={mobileSubLink}>
                {item.label}
              </Link>
            ))}
          </div>
        </MobileAccordionPanel>
      </div>
    </nav>
  ) : null;

  return (
    <>
    <div className={`mb-3 sm:mb-4 lg:mb-10 ${className}`}>
      <div
        ref={navRef}
        className={`max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:backdrop-blur-none rounded-card border border-line bg-card px-3 py-2 backdrop-blur-none sm:px-4 sm:py-2.5 lg:rounded-pill lg:border lg:bg-card lg:px-4 lg:py-3 lg:backdrop-blur-sm xl:px-5 ${innerClassName}`}
      >
        {/* Desktop — lg+; 3-column grid keeps brand / links / profile in separate tracks so centered links never paint over the icon */}
        <div
          className={`hidden w-full min-w-0 items-center gap-x-2 gap-y-1 sm:gap-x-3 lg:grid xl:gap-x-4 ${ showPrimaryNav ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_auto] justify-between" }`}
        >
          <Link
            href={brandHref}
            className="shrink-0 self-center whitespace-nowrap text-caption text-ink xl:text-small"
          >
            <Wordmark />
          </Link>

          {showPrimaryNav ? (
            <nav
              aria-label="Primary"
              className="flex w-full min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-0.5 sm:gap-x-2.5 sm:gap-y-1 xl:gap-x-3 2xl:gap-x-4"
            >
              <Link href={homeHref} className={homeOn ? linkActive : linkIdle}>
                Home
              </Link>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggle("pickup")}
                  className={
                    hubDropdownActive(pathname, "pickup") || pickupOpen
                      ? linkActive
                      : linkIdle
                  }
                >
                  Pickup Games
                </button>
                {pickupOpen ? (
                  <div className="absolute left-0 top-full z-[100] mt-2 min-w-[220px] rounded-card border border-line bg-canvas p-2 backdrop-blur-md">
                    {HUB_NAV_PICKUP.map((item) => (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        className="block rounded-button px-3 py-2 text-small text-ink transition hover:bg-overlay hover:text-ink"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                          e.preventDefault();
                          setOpenMenu(null);
                          pushWithAuthGate(item.href);
                        }}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggle("tournaments")}
                  className={
                    hubDropdownActive(pathname, "tournament") ||
                    tournamentsOpen
                      ? linkActive
                      : linkIdle
                  }
                >
                  Tournaments
                </button>
                {tournamentsOpen ? (
                  <div className="absolute left-0 top-full z-[100] mt-2 min-w-[220px] rounded-card border border-line bg-canvas p-2 backdrop-blur-md">
                    {HUB_NAV_TOURNAMENT.map((item) => (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        className="block rounded-button px-3 py-2 text-small text-ink transition hover:bg-overlay hover:text-ink"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                          e.preventDefault();
                          setOpenMenu(null);
                          pushWithAuthGate(item.href);
                        }}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>

              <Link
                href="/training"
                className={trainingOn ? linkActive : linkIdle}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate("/training");
                }}
              >
                Training
              </Link>

              <Link
                href="/u23"
                className={u23On ? linkActive : linkIdle}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate("/u23");
                }}
              >
                U23
              </Link>

              <Link
                href="/esports"
                className={esportsOn ? linkActive : linkIdle}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate("/esports");
                }}
              >
                Esports
              </Link>

              <Link
                href="/guidance"
                className={guidanceOn ? linkActive : linkIdle}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithAuthGate("/guidance");
                }}
              >
                Guidance
              </Link>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggle("about")}
                  className={
                    hubDropdownActive(pathname, "about") || aboutOpen
                      ? linkActive
                      : linkIdle
                  }
                >
                  About
                </button>
                {aboutOpen ? (
                  <div className="absolute right-0 top-full z-[100] mt-2 min-w-[200px] rounded-card border border-line bg-canvas p-2 backdrop-blur-md">
                    {HUB_NAV_ABOUT.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block rounded-button px-3 py-2 text-small text-ink transition hover:bg-overlay hover:text-ink"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </nav>
          ) : null}

          {desktopRight}
        </div>

        {/* Tablet & mobile — compact bar; full nav in portal sheet */}
        <div
          ref={mobileBarRef}
          className="lg:hidden sticky top-0 z-[320] -mx-1 flex flex-col border-b border-line bg-canvas px-1 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur-md"
        >
          <div className="flex min-h-[44px] items-center justify-between gap-2">
            <Link
              href={brandHref}
              className="flex min-w-0 -ml-0.5 items-center gap-2 py-2 pl-0.5 pr-2 text-caption leading-none text-ink"
              aria-label={PRODUCT_NAME}
            >
              <Monogram size={24} />
              <Wordmark className="max-sm:hidden" />
            </Link>
            <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
              {showHistoryBack ? (
                <HistoryBack
                  fallbackHref={fallbackHref}
                  label={backLabel}
                  className={mobileHeaderBackClass}
                />
              ) : null}
              {profileSection ? (
                <Link
                  href="/profile"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-muted transition-colors hover:bg-overlay-subtle hover:text-ink active:bg-overlay"
                  aria-label={`Profile (${profileSection.displayName})`}
                  title={profileSection.displayName}
                >
                  <UserIcon />
                </Link>
              ) : rightSlot ? (
                <div className="shrink-0">{rightSlot}</div>
              ) : null}
              {showPrimaryNav ? (
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-button text-ink transition-colors hover:bg-overlay active:bg-overlay"
                  aria-expanded={mobileSheetOpen}
                  aria-controls="mobile-nav-sheet"
                  aria-label={mobileSheetOpen ? "Close menu" : "Open menu"}
                  onClick={() => {
                    if (mobileSheetOpen) {
                      setMobileSheetOpen(false);
                      return;
                    }
                    const el = mobileBarRef.current;
                    if (el) {
                      const b = el.getBoundingClientRect().bottom;
                      setOverlayTopPx(Math.max(48, b));
                    }
                    setMobileSheetOpen(true);
                  }}
                >
                  <MobileMenuIcon open={mobileSheetOpen} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
    <MobileNavSheetPortal
      open={mobileSheetOpen && showPrimaryNav}
      overlayTopPx={overlayTopPx}
      onClose={closeMobileSheet}
    >
      {mobileSheetNav}
    </MobileNavSheetPortal>
    </>
  );
}
