import { APP_STORE_URL, PRODUCT_NAME } from "@/lib/brand";
import { siteOrigin } from "@/lib/env";

/**
 * The invite text: short copy, the App Store page (the site URL only when no App Store link is configured) and the
 * player's referral code when they have one. Used by the Invite friends share sheet and the contacts invite.
 */
export async function buildInviteMessage(accessToken: string | null | undefined): Promise<string> {
  const origin = siteOrigin();
  let code: string | null = null;

  if (origin && accessToken) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${origin}/api/referral/code`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as { referral_code?: string } | null;
      if (res.ok && typeof json?.referral_code === "string") code = json.referral_code;
    } catch {
      code = null; // No code is fine: the invite still goes out.
    } finally {
      clearTimeout(timer);
    }
  }

  const link = APP_STORE_URL || origin || "";
  return `Join me on ${PRODUCT_NAME} — competitive pickup soccer. ${link}` + (code ? `\nUse my referral code ${code} when you sign up.` : "");
}
