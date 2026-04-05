import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms } from "@/lib/twilio/sendSms";

export type InvitePlayer = {
  user_id: string;
  tier_rank: number;
  instagram: string | null;
  phone: string | null;
};

export async function insertInvitesForTierRanks(
  admin: SupabaseClient,
  run_id: string,
  tierRanks: number[],
  wave: number,
  now: string
): Promise<{ ok: false; error: string } | { ok: true; newlyInvited: InvitePlayer[] }> {
  const uniqTiers = Array.from(new Set(tierRanks)).filter((n) => Number.isFinite(n));
  if (!uniqTiers.length) return { ok: true, newlyInvited: [] };

  const ppl = await admin
    .from("profiles")
    .select("id,tier_rank,approved,instagram,phone")
    .in("tier_rank", uniqTiers)
    .eq("approved", true);

  if (ppl.error) return { ok: false, error: ppl.error.message };

  const candidates: InvitePlayer[] = (ppl.data || []).map((p) => ({
    user_id: p.id,
    tier_rank: p.tier_rank ?? 6,
    instagram: p.instagram || null,
    phone: p.phone || null,
  }));

  const rows = candidates.map((p) => ({
    run_id,
    user_id: p.user_id,
    wave,
    invited_tier_rank: p.tier_rank,
    invited_at: now,
  }));

  if (!rows.length) return { ok: true, newlyInvited: [] };

  const existingRes = await admin.from("pickup_run_invites").select("user_id").eq("run_id", run_id);
  if (existingRes.error) return { ok: false, error: existingRes.error.message };

  const existingUserIds = new Set((existingRes.data || []).map((r) => r.user_id));
  const newRows = rows.filter((r) => !existingUserIds.has(r.user_id));
  const newlyInvited = candidates.filter((p) => !existingUserIds.has(p.user_id));

  if (!newRows.length) return { ok: true, newlyInvited: [] };

  const inviteInsert = await admin.from("pickup_run_invites").insert(newRows);
  if (inviteInsert.error) return { ok: false, error: inviteInsert.error.message };

  return { ok: true, newlyInvited };
}

export async function sendPickupInviteSms(players: InvitePlayer[], message: string) {
  const withPhone = players.filter((p) => p.phone);
  const results = await Promise.all(
    withPhone.map(async (p) => {
      const result = await sendSms({
        to: p.phone as string,
        body: message,
        kind: "run_invite",
        correlationId: p.user_id,
      });
      return result.ok;
    })
  );
  return {
    sms_sent: results.filter(Boolean).length,
    sms_failed: results.length - results.filter(Boolean).length,
  };
}
