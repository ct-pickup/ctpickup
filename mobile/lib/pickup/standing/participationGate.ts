import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPPORT_EMAIL_ADDRESS } from "@/lib/supportEmail";

export type PickupParticipationGateResult =
  | { ok: true }
  | { ok: false; code: "standing_not_eligible"; detail: string };

/**
 * Enforces cached pickup eligibility (standing + current waiver flag on the standing row).
 * Call after `userHasAcceptedCurrentWaiver` in user-facing flows so waiver errors stay distinct.
 */
export async function assertPickupStandingAllowsParticipation(
  admin: SupabaseClient,
  userId: string,
): Promise<PickupParticipationGateResult> {
  const { data } = await admin
    .from("pickup_player_standing")
    .select("pickup_eligible, effective_standing, waiver_current")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { ok: true };

  if (!data.pickup_eligible) {
    const tier = String(data.effective_standing || "");
    const reason =
      tier === "suspended" || tier === "banned"
        ? `Account standing is “${tier}”. If you think this is a mistake, email ${SUPPORT_EMAIL_ADDRESS}.`
        : !data.waiver_current
          ? "Participation requires an up-to-date waiver."
          : `Pickup participation is not available for this account right now. Email ${SUPPORT_EMAIL_ADDRESS} or visit /help.`;
    return { ok: false, code: "standing_not_eligible", detail: reason };
  }

  return { ok: true };
}

/** Use when building curated invite lists: false only when a standing row exists and pickup is ineligible. */
export async function userPassesPickupStandingForInvite(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("pickup_player_standing")
    .select("pickup_eligible")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return true;
  return data.pickup_eligible === true;
}
