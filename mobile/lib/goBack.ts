import type { Href, useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

/**
 * Back means one step back to where the player came from. When there is no history (the screen was opened from a push
 * notification or a link), go to `fallback`, the screen's natural parent. Never Home unless Home is that parent.
 */
export function goBack(router: Pick<Router, "back" | "canGoBack" | "replace">, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
