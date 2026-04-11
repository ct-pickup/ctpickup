import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Best-effort label for an opponent (EA / platform IDs preferred, then name/email).
 */
export async function formatEsportsOpponentLabel(
  svc: SupabaseClient,
  opponentUserId: string,
): Promise<string> {
  const [{ data: opponentProfile }, { data: opponentAppProfile }] = await Promise.all([
    svc
      .from("esports_player_profiles")
      .select("platform,psn_id,xbox_gamertag,ea_account")
      .eq("user_id", opponentUserId)
      .maybeSingle(),
    svc.from("profiles").select("first_name,last_name,email").eq("id", opponentUserId).maybeSingle(),
  ]);

  let opponentLabel = "Opponent";
  const op = opponentProfile as {
    platform?: string | null;
    psn_id?: string | null;
    xbox_gamertag?: string | null;
    ea_account?: string | null;
  } | null;

  if (op?.platform === "playstation" && op?.psn_id) opponentLabel = `PlayStation · ${String(op.psn_id)}`;
  if (op?.platform === "xbox" && op?.xbox_gamertag) opponentLabel = `Xbox · ${String(op.xbox_gamertag)}`;
  if (op?.ea_account && typeof op.ea_account === "string" && op.ea_account.trim()) {
    opponentLabel += ` · EA: ${op.ea_account.trim()}`;
  }
  if (opponentLabel === "Opponent") {
    const ap = opponentAppProfile as { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
    const first = typeof ap?.first_name === "string" ? ap.first_name.trim() : "";
    const last = typeof ap?.last_name === "string" ? ap.last_name.trim() : "";
    const full = `${first} ${last}`.trim();
    const email = typeof ap?.email === "string" ? ap.email.trim() : "";
    if (full) opponentLabel = full;
    else if (email) opponentLabel = email;
    else opponentLabel = `User ${opponentUserId}`;
  }

  return opponentLabel;
}
