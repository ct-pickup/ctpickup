export type SiteNavItem = { href: string; label: string };

/** Logged-out / marketing hub — Home is `/`. */
export const SITE_NAV_PUBLIC: SiteNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/pickup", label: "Pickup" },
  { href: "/tournament", label: "Tournament" },
  { href: "/training", label: "Training" },
  { href: "/u23", label: "U23" },
  { href: "/community", label: "Community" },
];

const appBase: SiteNavItem[] = [
  { href: "/after-login", label: "Home" },
  { href: "/pickup", label: "Pickup" },
  { href: "/tournament", label: "Tournament" },
  { href: "/training", label: "Training" },
  { href: "/u23", label: "U23" },
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
  if (href === "/after-login") {
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
  { label: "Upcoming Tournaments", href: "/tournament" },
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
