import type { Href, Router } from "expo-router";

/** Main admin menu route — nested under the Admin tab (`app/(tabs)/admin/index.tsx`). */
export const ADMIN_MENU_HREF = "/admin" as Href;

export function isAdminMenuPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "");
  return p === "/admin" || p === "/(tabs)/admin";
}

export function goToAdminMenu(router: Pick<Router, "replace">): void {
  router.replace(ADMIN_MENU_HREF);
}
