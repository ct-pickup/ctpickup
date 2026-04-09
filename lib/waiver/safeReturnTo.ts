import { SIGNUP_INTENT_QUERY, isSignupIntent } from "@/lib/auth/signupIntent";

/**
 * Allowed targets for ?returnTo= on /liability-waiver (open-redirect safe).
 */
const ALLOWED_PATHS = new Set(["/onboarding"]);

/**
 * Returns a same-origin path only (optionally with safe query for signup intent), or null.
 */
export function safeWaiverReturnTo(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.trim());
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  if (decoded.includes("//")) return null;

  const q = decoded.indexOf("?");
  const pathOnly = q === -1 ? decoded : decoded.slice(0, q);
  const search = q === -1 ? "" : decoded.slice(q);

  if (pathOnly === "/signup") {
    if (!search) return null;
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const intent = params.get(SIGNUP_INTENT_QUERY);
    if (!isSignupIntent(intent)) return null;
    return `/signup?${SIGNUP_INTENT_QUERY}=${intent}`;
  }

  if (ALLOWED_PATHS.has(pathOnly)) return pathOnly;
  return null;
}
