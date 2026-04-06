/**
 * Allowed targets for ?returnTo= on /liability-waiver (open-redirect safe).
 */
const ALLOWED = new Set(["/signup", "/onboarding"]);

/**
 * Returns a same-origin path only, or null.
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
  const pathOnly = decoded.split("?")[0].split("#")[0];
  if (ALLOWED.has(pathOnly)) return pathOnly;
  return null;
}
