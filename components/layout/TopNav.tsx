"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[15px] font-light leading-none tabular-nums text-white/50"
    >
      {expanded ? "−" : "+"}
    </span>
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
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!openMenu) return;
      const el = navRef.current;
      if (el && !el.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

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

  const mobileNavItem = (active: boolean) =>
    [
      "flex min-h-[42px] items-center px-3 py-2 text-[13px] font-medium tracking-tight transition-colors active:bg-white/[0.06]",
      active ? "text-white" : "text-white/78 hover:text-white/95",
    ].join(" ");

  const mobileAccordionBtn = (active: boolean) =>
    [
      "flex min-h-[42px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-medium tracking-tight transition-colors active:bg-white/[0.06]",
      active ? "text-white" : "text-white/78 hover:text-white/95",
    ].join(" ");

  const mobileSubLink =
    "flex min-h-10 items-center rounded-md py-1.5 pl-3 pr-3 text-[13px] font-normal leading-snug text-white/62 transition hover:bg-white/[0.05] hover:text-white/90 active:bg-white/[0.07]";

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

  return (
    <div className={`mb-6 sm:mb-8 lg:mb-10 ${className}`}>
      <div
        ref={navRef}
        className={`rounded-2xl border border-white/15 bg-white/6 px-3 py-2 backdrop-blur-none sm:px-4 sm:py-2.5 lg:rounded-full lg:px-4 lg:py-3 lg:backdrop-blur-sm xl:px-5 ${innerClassName}`}
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

        {/* Tablet & mobile — single surface, compact rhythm; lg+ uses desktop row */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.09] pb-2.5">
            <Link
              href={brandHref}
              className="min-w-0 py-0.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-white/92 sm:text-xs sm:tracking-[0.18em]"
            >
              CT Pickup
            </Link>
            <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
              {showHistoryBack ? (
                <HistoryBack
                  fallbackHref={fallbackHref}
                  label={backLabel}
                  className={mobileHeaderBackClass}
                />
              ) : null}
              {profileSection ? (
                <div className="flex max-w-[min(100%,10.5rem)] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-2 py-1 sm:max-w-[11rem] sm:px-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]">
                    <UserIcon />
                  </div>
                  <div className="truncate text-[12px] font-medium text-white/88">
                    {profileSection.displayName}
                  </div>
                </div>
              ) : rightSlot ? (
                <div className="shrink-0">{rightSlot}</div>
              ) : null}
            </div>
          </div>

          {showPrimaryNav ? (
            <nav
              aria-label="Primary"
              className="mt-2 overflow-hidden rounded-xl border border-white/[0.09] bg-black/25"
            >
              <div className="divide-y divide-white/[0.07]">
                <Link href={homeHref} className={mobileNavItem(homeOn)}>
                  Home
                </Link>

                <div>
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
                  {pickupOpen ? (
                    <div className="border-t border-white/[0.07] bg-black/35 px-2 py-1">
                      <div className="space-y-0.5 border-l border-white/10 pl-2">
                        {HUB_NAV_PICKUP.map((item) => (
                          <Link
                            key={item.href + item.label}
                            href={item.href}
                            className={mobileSubLink}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <button
                    type="button"
                    aria-expanded={tournamentsOpen}
                    onClick={() => toggle("tournaments")}
                    className={mobileAccordionBtn(
                      hubDropdownActive(pathname, "tournament") ||
                        tournamentsOpen,
                    )}
                  >
                    <span className="min-w-0 flex-1">Tournaments</span>
                    <MobileChevron expanded={tournamentsOpen} />
                  </button>
                  {tournamentsOpen ? (
                    <div className="border-t border-white/[0.07] bg-black/35 px-2 py-1">
                      <div className="space-y-0.5 border-l border-white/10 pl-2">
                        {HUB_NAV_TOURNAMENT.map((item) => (
                          <Link
                            key={item.href + item.label}
                            href={item.href}
                            className={mobileSubLink}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
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

                <div>
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
                  {aboutOpen ? (
                    <div className="border-t border-white/[0.07] bg-black/35 px-2 py-1">
                      <div className="space-y-0.5 border-l border-white/10 pl-2">
                        {HUB_NAV_ABOUT.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={mobileSubLink}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
