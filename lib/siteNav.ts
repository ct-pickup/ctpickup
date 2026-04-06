export type SiteNavItem = { href: string; label: string };

/** In-app Home (returning users — no “first visit” greeting flag). */
export const APP_HOME_URL = "/after-login";

/**
 * First hub load after sign-up — `/after-login` reads `?new=1` for “Welcome, …” vs “Welcome back, …”.
 * Use for signup completion + signup email redirect only; login and global nav use `APP_HOME_URL`.
 */
export const APP_HOME_FIRST_VISIT_URL = "/after-login?new=1";

/** Logged-out / marketing hub — Home is `/`. */
export const SITE_NAV_PUBLIC: SiteNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/tournament", label: "Tournament" },
  { href: "/training", label: "Training" },
  { href: "/u23", label: "U23" },
  { href: "/esports", label: "Esports" },
  { href: "/guidance", label: "Guidance" },
  { href: "/community", label: "Community" },
];

const appBase: SiteNavItem[] = [
  { href: APP_HOME_URL, label: "Home" },
  { href: "/tournament", label: "Tournament" },
  { href: "/training", label: "Training" },
  { href: "/u23", label: "U23" },
  { href: "/esports", label: "Esports" },
  { href: "/guidance", label: "Guidance" },
];

/** Post-login hub pages — last link emphasizes Community. */
export const SITE_NAV_APP_COMMUNITY: SiteNavItem[] = [
  ...appBase,
  { href: "/community", label: "Community" },
];

/** Rules / mission style footer nav — Mission as sixth item. */
export const SITE_NAV_APP_MISSION: SiteNavItem[] = [
  ...appBase,
  { href: "/mission", label: "Mission" },
];

/** Help-style — About → `/info`. */
export const SITE_NAV_APP_ABOUT: SiteNavItem[] = [
  ...appBase,
  { href: "/info", label: "About" },
];

export function navItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  const hrefPath = href.split("?")[0];
  if (hrefPath === "/after-login") {
    return (
      pathname === "/after-login" || pathname.startsWith("/after-login/")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Shared with `TopNav` — same entries as `/after-login` dropdowns. */
export type HubNavLink = { label: string; href: string };

export const HUB_NAV_PICKUP: HubNavLink[] = [
  { label: "Upcoming Games", href: "/pickup/upcoming-games" },
  { label: "How It Works", href: "/pickup/how-it-works" },
  { label: "Join a Game", href: "/pickup/join-a-game" },
];

export const HUB_NAV_TOURNAMENT: HubNavLink[] = [
  { label: "How It Works", href: "/tournament/how-it-works" },
  { label: "Join a Tournament", href: "/tournament" },
];

export const HUB_NAV_ABOUT: HubNavLink[] = [
  { label: "Mission", href: "/mission" },
  { label: "Rules", href: "/rules" },
  { label: "Community", href: "/community" },
];

export function hubDropdownActive(
  pathname: string,
  key: "pickup" | "tournament" | "about",
): boolean {
  if (key === "pickup") return navItemActive(pathname, "/pickup");
  if (key === "tournament") return navItemActive(pathname, "/tournament");
  return HUB_NAV_ABOUT.some((l) => navItemActive(pathname, l.href));
}
