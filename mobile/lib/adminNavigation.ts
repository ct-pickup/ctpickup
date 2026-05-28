import type { Href } from "expo-router";
import type { Router } from "expo-router";

/** Main admin menu route (stack index). */
export const ADMIN_MENU_HREF = "/admin" as Href;

export function goToAdminMenu(router: Pick<Router, "replace">): void {
  router.replace(ADMIN_MENU_HREF);
}
