/**
 * Twilio signs the full URL of the webhook. This must match the URL configured in Twilio Console
 * (including scheme and path). Prefer TWILIO_WEBHOOK_BASE_URL or NEXT_PUBLIC_SITE_URL on Vercel.
 */
function trimBase(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export function buildPublicWebhookUrl(req: Request): string {
  const pathWithQuery = new URL(req.url).pathname + new URL(req.url).search;

  const explicitBase = process.env.TWILIO_WEBHOOK_BASE_URL
    ? trimBase(process.env.TWILIO_WEBHOOK_BASE_URL)
    : null;
  if (explicitBase) {
    return `${explicitBase}${pathWithQuery}`;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ? trimBase(process.env.NEXT_PUBLIC_SITE_URL) : null;
  if (site) {
    return `${site}${pathWithQuery}`;
  }

  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim();
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";

  if (host) {
    return `${proto}://${host}${pathWithQuery}`;
  }

  return new URL(req.url).toString();
}
