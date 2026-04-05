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
import { usePathname } from "next/navigation";
import {
  APP_HOME_URL,
  HUB_NAV_ABOUT,
  HUB_NAV_PICKUP,
  HUB_NAV_TOURNAMENT,
  hubDropdownActive,
  navItemActive,
} from "@/lib/siteNav";
import { HistoryBack } from "./HistoryBack";

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
      className="flex h-[44px] w-8 shrink-0 items-center justify-center text-[15px] font-light leading-none tabular-nums text-white/[0.28] antialiased"
    >
      {expanded ? "\u2212" : "+"}
    </span>
  );
}

/** Smooth height expand/collapse without changing open/close logic. */
function MobileAccordionPanel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
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
        className="relative z-10 min-h-0 w-full shrink-0 overflow-y-auto overscroll-y-contain border-b border-white/[0.08] bg-[#121213] shadow-[0_28px_80px_rgba(0,0,0,0.55)] [touch-action:manipulation]"
        style={{
          maxHeight: `calc(100dvh - ${topPx}px)`,
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </div>
      <div
        role="presentation"
        aria-hidden
        className="relative z-0 min-h-0 flex-1 bg-black/70 backdrop-blur-[3px] [touch-action:manipulation]"
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
      className="text-white/75"
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
      className="text-white/80"
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
  brandHref = APP_HOME_URL,
  homeHref = APP_HOME_URL,
  fallbackHref = APP_HOME_URL,
  backLabel = "Back",
  rightSlot,
  profileSection,
  showPrimaryNav = true,
  className = "",
  innerClassName = "",
}: {
  /** Logo “CT Pickup” target */
  brandHref?: string;
  /** Top-level Home link (default: `APP_HOME_URL`) */
  homeHref?: string;
  /** When history has no in-app previous step. */
  fallbackHref?: string;
  backLabel?: string;
  /** Replaces profile when set (e.g. Help); Back (when shown) appears before this slot. */
  rightSlot?: React.ReactNode;
  /** Right-side profile chip like `/after-login`. */
  profileSection?: { displayName: string };
  /** Hub links (Home, Pickup, Tournaments, …). `/help` passes `false` for guests after auth is known. */
  showPrimaryNav?: boolean;
  className?: string;
  innerClassName?: string;
}) {
  const pathname = usePathname() || "";
  const [openMenu, setOpenMenu] = useState<NavMenu>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [overlayTopPx, setOverlayTopPx] = useState(0);
  const navRef = useRef<HTMLDivElement>(null);
  const mobileBarRef = useRef<HTMLDivElement>(null);

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
      const target = e.target as Node;
      const el = navRef.current;
      if (el?.contains(target)) return;
      // Mobile sheet is portaled to document.body — outside navRef but still in-app menu.
      const sheet = typeof document !== "undefined" ? document.getElementById("mobile-nav-sheet") : null;
      if (sheet?.contains(target)) return;
      setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

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
    "shrink-0 whitespace-nowrap text-[13px] font-medium transition xl:text-sm";
  const linkIdle = `${linkBase} text-white/80 hover:text-white`;
  const linkActive = `${linkBase} text-white`;

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
    "shrink-0 text-sm text-white/75 transition hover:text-white inline-flex items-center justify-center min-h-[44px] rounded-lg px-2 -mx-0.5 active:bg-white/5 lg:min-h-0 lg:rounded-none lg:px-0 lg:mx-0 lg:active:bg-transparent";

  /** Compact back control for the mobile header row only */
  const mobileHeaderBackClass =
    "shrink-0 text-[13px] font-medium text-white/65 transition hover:text-white inline-flex items-center justify-center min-h-10 rounded-lg px-2.5 active:bg-white/[0.07]";

  const showHistoryBack = topNavShowsHistoryBack(pathname);

  const mobileRowBase =
    "touch-manipulation flex min-h-[44px] w-full items-center rounded-[6px] pl-1.5 pr-1.5 text-left text-[15px] font-medium leading-none tracking-[-0.012em] transition-colors active:bg-white/[0.055]";

  const mobileNavItem = (active: boolean) =>
    [
      mobileRowBase,
      active ? "text-white" : "text-white/[0.82] hover:bg-white/[0.035] hover:text-white/[0.94]",
    ].join(" ");

  const mobileAccordionBtn = (active: boolean) =>
    [
      "touch-manipulation flex min-h-[44px] w-full items-center rounded-[6px] pl-1.5 pr-0 text-left text-[15px] font-medium leading-none tracking-[-0.012em] transition-colors active:bg-white/[0.055]",
      "justify-between gap-1",
      active ? "text-white" : "text-white/[0.82] hover:bg-white/[0.035] hover:text-white/[0.94]",
    ].join(" ");

  const mobileSubLink =
    "relative z-[2] flex min-h-[36px] w-full items-center border-l border-white/[0.09] py-[7px] pl-3.5 pr-1.5 text-[11px] font-normal leading-[1.4] tracking-[0.01em] text-white/[0.38] transition-colors [touch-action:manipulation] hover:bg-white/[0.025] hover:text-white/[0.62] active:bg-white/[0.04]";

  const profilePill = profileSection ? (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20">
        <UserIcon />
      </div>
      <div className="max-w-[140px] truncate text-sm font-medium text-white/90">
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
      <Link href={homeHref} className={mobileNavItem(homeOn)}>
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
              <Link key={item.href + item.label} href={item.href} className={mobileSubLink}>
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
              <Link key={item.href + item.label} href={item.href} className={mobileSubLink}>
                {item.label}
              </Link>
            ))}
          </div>
        </MobileAccordionPanel>
      </div>

      <Link href="/training" className={mobileNavItem(trainingOn)}>
        Training
      </Link>

      <Link href="/u23" className={mobileNavItem(u23On)}>
        U23
      </Link>

      <Link href="/esports" className={mobileNavItem(esportsOn)}>
        Esports
      </Link>

      <Link href="/guidance" className={mobileNavItem(guidanceOn)}>
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
        className={`max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none max-lg:backdrop-blur-none rounded-2xl border border-white/15 bg-white/6 px-3 py-2 backdrop-blur-none sm:px-4 sm:py-2.5 lg:rounded-full lg:border lg:bg-white/6 lg:px-4 lg:py-3 lg:backdrop-blur-sm xl:px-5 ${innerClassName}`}
      >
        {/* Desktop — lg+ only so all links fit on one row without colliding with logo/profile */}
        <div className="hidden items-center justify-between gap-3 lg:flex xl:gap-4">
          <Link
            href={brandHref}
            className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-white/90 xl:text-sm xl:tracking-[0.22em]"
          >
            CT Pickup
          </Link>

          {showPrimaryNav ? (
            <nav
              aria-label="Primary"
              className="flex min-w-0 max-w-full flex-1 flex-nowrap items-center justify-center gap-x-2 px-0.5 sm:gap-x-2.5 xl:gap-x-3 2xl:gap-x-4"
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
                  <div className="absolute left-0 top-full z-[100] mt-2 min-w-[220px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
                    {HUB_NAV_PICKUP.map((item) => (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        className="block rounded-lg px-3 py-2 text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
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
                  <div className="absolute left-0 top-full z-[100] mt-2 min-w-[220px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
                    {HUB_NAV_TOURNAMENT.map((item) => (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        className="block rounded-lg px-3 py-2 text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
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
              >
                Training
              </Link>

              <Link href="/u23" className={u23On ? linkActive : linkIdle}>
                U23
              </Link>

              <Link
                href="/esports"
                className={esportsOn ? linkActive : linkIdle}
              >
                Esports
              </Link>

              <Link
                href="/guidance"
                className={guidanceOn ? linkActive : linkIdle}
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
                  <div className="absolute right-0 top-full z-[100] mt-2 min-w-[200px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
                    {HUB_NAV_ABOUT.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block rounded-lg px-3 py-2 text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
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
          className="lg:hidden sticky top-0 z-[320] -mx-1 flex flex-col border-b border-white/[0.07] bg-[#0f0f10]/92 px-1 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur-md supports-[backdrop-filter]:bg-[#0f0f10]/88"
        >
          <div className="flex min-h-[44px] items-center justify-between gap-2">
            <Link
              href={brandHref}
              className="min-w-0 -ml-0.5 py-2 pl-0.5 pr-2 text-[11px] font-semibold uppercase leading-none tracking-[0.17em] text-white/[0.88] sm:tracking-[0.18em]"
            >
              CT Pickup
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.055] hover:text-white/90 active:bg-white/[0.08]"
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
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
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
