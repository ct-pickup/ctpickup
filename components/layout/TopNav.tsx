"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  HUB_NAV_ABOUT,
  HUB_NAV_PICKUP,
  HUB_NAV_TOURNAMENT,
  hubDropdownActive,
  navItemActive,
} from "@/lib/siteNav";

type NavMenu = "pickup" | "tournaments" | "about" | null;

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
  brandHref = "/",
  homeHref = "/",
  backHref = "/",
  backLabel = "Back",
  showBack = true,
  rightSlot,
  profileSection,
  className = "",
  innerClassName = "",
}: {
  /** Logo “CT Pickup” target */
  brandHref?: string;
  /** Top-level Home link (matches `/after-login`) */
  homeHref?: string;
  backHref?: string;
  backLabel?: string;
  showBack?: boolean;
  /** Replaces profile + back (e.g. Help page). */
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

  function toggle(menu: Exclude<NavMenu, null>) {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  const pickupOpen = openMenu === "pickup";
  const tournamentsOpen = openMenu === "tournaments";
  const aboutOpen = openMenu === "about";

  const linkBase = "text-sm font-medium transition";
  const linkIdle = `${linkBase} text-white/80 hover:text-white`;
  const linkActive = `${linkBase} text-white`;

  const trainingOn = navItemActive(pathname, "/training");
  const u23On = navItemActive(pathname, "/u23");
  const homeOn = pathname === homeHref || (homeHref === "/" && pathname === "/");

  const rightExtra = rightSlot ? (
    <div className="shrink-0">{rightSlot}</div>
  ) : profileSection ? (
    <div className="hidden shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 md:flex">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20">
        <UserIcon />
      </div>
      <div className="max-w-[140px] truncate text-sm font-medium text-white/90">
        {profileSection.displayName}
      </div>
    </div>
  ) : showBack ? (
    <Link
      href={backHref}
      className="shrink-0 text-sm text-white/75 transition hover:text-white"
    >
      {backLabel}
    </Link>
  ) : (
    <div className="hidden w-14 shrink-0 md:block" aria-hidden />
  );

  return (
    <div className={`mb-8 sm:mb-10 ${className}`}>
      <div
        ref={navRef}
        className={`rounded-full border border-white/15 bg-white/6 px-5 py-3 backdrop-blur-sm ${innerClassName}`}
      >
        {/* Desktop */}
        <div className="hidden items-center justify-between gap-4 md:flex">
          <Link
            href={brandHref}
            className="shrink-0 text-sm font-semibold uppercase tracking-[0.22em] text-white/90 sm:text-base"
          >
            CT Pickup
          </Link>

          <nav className="flex min-w-0 flex-1 items-center justify-center gap-6 text-sm lg:gap-7">
            <Link href={homeHref} className={homeOn ? linkActive : linkIdle}>
              Home
            </Link>

            <div className="relative">
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
                <div className="absolute left-0 top-full z-30 mt-2 min-w-[220px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
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

            <div className="relative">
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
                <div className="absolute left-0 top-full z-30 mt-2 min-w-[220px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
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

            <div className="relative">
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
                <div className="absolute right-0 top-full z-30 mt-2 min-w-[200px] rounded-xl border border-white/15 bg-[#141415] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
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

          {rightExtra}
        </div>

        {/* Mobile */}
        <div className="space-y-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={brandHref}
              className="text-sm font-semibold uppercase tracking-[0.22em] text-white/90"
            >
              CT Pickup
            </Link>
            {profileSection ? (
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20">
                  <UserIcon />
                </div>
                <div className="max-w-[100px] truncate text-xs font-medium text-white/90">
                  {profileSection.displayName}
                </div>
              </div>
            ) : rightSlot ? (
              <div className="shrink-0 scale-90">{rightSlot}</div>
            ) : showBack ? (
              <Link
                href={backHref}
                className="shrink-0 text-sm text-white/75"
              >
                {backLabel}
              </Link>
            ) : null}
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
