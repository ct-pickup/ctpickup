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
    "shrink-0 text-sm text-white/75 transition hover:text-white";

  const showHistoryBack = topNavShowsHistoryBack(pathname);

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
    <div className={`mb-8 sm:mb-10 ${className}`}>
      <div
        ref={navRef}
        className={`rounded-full border border-white/15 bg-white/6 px-3 py-2.5 backdrop-blur-sm sm:px-4 lg:px-4 lg:py-3 xl:px-5 ${innerClassName}`}
      >
        {/* Desktop — lg+ only so all links fit on one row without colliding with logo/profile */}
        <div className="hidden items-center justify-between gap-3 lg:flex xl:gap-4">
          <Link
            href={brandHref}
            className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-white/90 xl:text-sm xl:tracking-[0.22em]"
          >
            CT Pickup
          </Link>

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
                  hubDropdownActive(pathname, "tournament") || tournamentsOpen
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

          {desktopRight}
        </div>

        {/* Tablet & mobile — same breakpoint as desktop row */}
        <div className="space-y-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={brandHref}
              className="text-sm font-semibold uppercase tracking-[0.22em] text-white/90"
            >
              CT Pickup
            </Link>
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {showHistoryBack ? (
                <HistoryBack
                  fallbackHref={fallbackHref}
                  label={backLabel}
                  className={backClass}
                />
              ) : null}
              {profileSection ? (
                <div className="flex max-w-[min(100%,11rem)] items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-1.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20">
                    <UserIcon />
                  </div>
                  <div className="truncate text-xs font-medium text-white/90">
                    {profileSection.displayName}
                  </div>
                </div>
              ) : rightSlot ? (
                <div className="shrink-0 scale-90">{rightSlot}</div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Link
              href={homeHref}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white/90"
            >
              Home
            </Link>

            <div className="overflow-hidden rounded-xl border border-white/15">
              <button
                type="button"
                onClick={() => toggle("pickup")}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white/90"
              >
                <span>Pickup Games</span>
                <span className="text-white/50">{pickupOpen ? "−" : "+"}</span>
              </button>
              {pickupOpen ? (
                <div className="border-t border-white/10 px-2 py-2">
                  {HUB_NAV_PICKUP.map((item) => (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className="block rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-xl border border-white/15">
              <button
                type="button"
                onClick={() => toggle("tournaments")}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white/90"
              >
                <span>Tournaments</span>
                <span className="text-white/50">
                  {tournamentsOpen ? "−" : "+"}
                </span>
              </button>
              {tournamentsOpen ? (
                <div className="border-t border-white/10 px-2 py-2">
                  {HUB_NAV_TOURNAMENT.map((item) => (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className="block rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <Link
              href="/training"
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white/90"
            >
              Training
            </Link>

            <Link
              href="/u23"
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white/90"
            >
              U23
            </Link>

            <Link
              href="/esports"
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white/90"
            >
              Esports
            </Link>

            <Link
              href="/guidance"
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white/90"
            >
              Guidance
            </Link>

            <div className="overflow-hidden rounded-xl border border-white/15">
              <button
                type="button"
                onClick={() => toggle("about")}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white/90"
              >
                <span>About</span>
                <span className="text-white/50">{aboutOpen ? "−" : "+"}</span>
              </button>
              {aboutOpen ? (
                <div className="border-t border-white/10 px-2 py-2">
                  {HUB_NAV_ABOUT.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
