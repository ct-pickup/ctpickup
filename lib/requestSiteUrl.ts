/**
 * Canonical public site origin for redirects, Stripe return URLs, and server-side self-fetch.
 * Prefer NEXT_PUBLIC_SITE_URL in production; falls back to Vercel or request headers.
 */
export function requestSiteUrlFromRequest(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return u.origin.replace(/\/$/, "");
  } catch {
    /* ignore */
  }

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") || "https")
      .split(",")[0]
      .trim();
    return `${proto}://${host.split(",")[0].trim()}`.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}
