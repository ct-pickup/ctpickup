import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReferralCodeInApp } from "@/lib/referral/generateReferralCode";

export async function ensureProfileReferralCode(
  admin: SupabaseClient,
  userId: string,
): Promise<{ code: string | null; error: string | null }> {
  const { data: row, error: loadErr } = await admin
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .maybeSingle();

  if (loadErr) {
    return { code: null, error: loadErr.message || "Could not load profile." };
  }

  const existing =
    typeof row?.referral_code === "string" && row.referral_code.trim()
      ? row.referral_code.trim().toUpperCase()
      : null;
  if (existing) return { code: existing, error: null };

  const rpc = await admin.rpc("ensure_profile_referral_code", { p_user_id: userId });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data.trim()) {
    return { code: rpc.data.trim().toUpperCase(), error: null };
  }

  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = generateReferralCodeInApp();
    const { error: updErr } = await admin
      .from("profiles")
      .update({ referral_code: candidate, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .is("referral_code", null);

    if (!updErr) {
      const { data: after } = await admin
        .from("profiles")
        .select("referral_code")
        .eq("id", userId)
        .maybeSingle();
      const code =
        typeof after?.referral_code === "string" && after.referral_code.trim()
          ? after.referral_code.trim().toUpperCase()
          : candidate;
      return { code, error: null };
    }

    if (!/unique|duplicate|23505/i.test(updErr.message ?? "")) {
      return { code: null, error: updErr.message || "Could not assign referral code." };
    }
  }

  return { code: null, error: "Could not assign referral code." };
}
