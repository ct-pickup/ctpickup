import { siteOrigin } from "@/lib/env";

export type ApplyReferralResult = { ok: true } | { ok: false; error: string };

/** Applies a friend's referral code. The one call behind Settings "Apply referral code" and the complete-profile field. */
export async function applyReferralCode(accessToken: string | null, rawCode: string): Promise<ApplyReferralResult> {
  const origin = siteOrigin();
  const code = rawCode.trim().toUpperCase();
  if (!origin || !accessToken || !code) return { ok: false, error: "Could not apply code." };
  try {
    const r = await fetch(`${origin}/api/referral/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ referral_code: code }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (r.ok) return { ok: true };
    return { ok: false, error: typeof j?.error === "string" ? j.error : "Could not apply code." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}
