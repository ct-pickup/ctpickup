import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSelectPickupRunType,
  SELECT_PICKUP_MAX_INVITE_TIER_RANK,
} from "@/lib/pickup/pickupRunType";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";
import { sendSms } from "@/lib/twilio/sendSms";

export type InvitePlayer = {
  user_id: string;
  tier_rank: number;
  instagram: string | null;
  phone: string | null;
};

/** When set, {@link insertInvitesForTierRanks} may invite tier_rank 5–6 on select runs (last-call only). */
export type InsertInvitesForTierRanksOptions = {
  selectEmergencyLastCall?: boolean;
};

export async function insertInvitesForTierRanks(
  admin: SupabaseClient,
  run_id: string,
  tierRanks: number[],
  wave: number,
  now: string,
  service_region?: string | null,
  pickupRunType?: unknown,
  options?: InsertInvitesForTierRanksOptions,
): Promise<{ ok: false; error: string } | { ok: true; newlyInvited: InvitePlayer[] }> {
  const uniqTiers = Array.from(new Set(tierRanks)).filter((n) => Number.isFinite(n));
  if (!uniqTiers.length) return { ok: true, newlyInvited: [] };

  if (isSelectPickupRunType(pickupRunType ?? "select") && !options?.selectEmergencyLastCall) {
    const disallowed = uniqTiers.filter((n) => n > SELECT_PICKUP_MAX_INVITE_TIER_RANK);
    if (disallowed.length) {
      return {
        ok: false,
        error: `Select pickup runs cannot invite tier_rank ${disallowed.join(", ")} (maximum is ${SELECT_PICKUP_MAX_INVITE_TIER_RANK}).`,
      };
    }
  }

  console.log("[insertInvitesForTierRanks] start", { run_id, tier_ranks: uniqTiers, wave, service_region: service_region ?? null });

  const ppl = await admin
    .from("profiles")
    .select("id,tier_rank,approved,instagram,phone,nearest_venue")
    .in("tier_rank", uniqTiers)
    .eq("approved", true);

  if (ppl.error) return { ok: false, error: ppl.error.message };

  const rawRows = ppl.data || [];
  let excludedByRegion = 0;
  const regionSamples: { user_id: string; nearest_venue: string | null; matches: boolean }[] = [];
  const candidates: InvitePlayer[] = rawRows
    .filter((p) => {
      const matches = profileMatchesRunServiceRegion(p.nearest_venue, service_region);
      if (!matches) {
        excludedByRegion += 1;
        if (regionSamples.length < 5) {
          regionSamples.push({
            user_id: p.id,
            nearest_venue: p.nearest_venue ?? null,
            matches,
          });
        }
      }
      return matches;
    })
    .map((p) => ({
      user_id: p.id,
      tier_rank: p.tier_rank ?? 6,
      instagram: p.instagram || null,
      phone: p.phone || null,
    }));

  console.log("[insertInvitesForTierRanks] after profile query + service_region filter", {
    run_id,
    approved_tier_rows: rawRows.length,
    after_region_filter: candidates.length,
    excluded_by_region: excludedByRegion,
    region_mismatch_samples: regionSamples,
  });

  const rows = candidates.map((p) => ({
    run_id,
    user_id: p.user_id,
    wave,
    invited_tier_rank: p.tier_rank,
    invited_at: now,
  }));

  if (!rows.length) {
    console.log("[insertInvitesForTierRanks] no candidate rows after filters", { run_id });
    return { ok: true, newlyInvited: [] };
  }

  const existingRes = await admin.from("pickup_run_invites").select("user_id").eq("run_id", run_id);
  if (existingRes.error) return { ok: false, error: existingRes.error.message };

  const existingUserIds = new Set((existingRes.data || []).map((r) => r.user_id));
  const newRows = rows.filter((r) => !existingUserIds.has(r.user_id));
  const newlyInvited = candidates.filter((p) => !existingUserIds.has(p.user_id));

  console.log("[insertInvitesForTierRanks] vs existing invites on run", {
    run_id,
    existing_invite_count: existingUserIds.size,
    candidate_count: rows.length,
    new_row_count: newRows.length,
  });

  if (!newRows.length) {
    console.log("[insertInvitesForTierRanks] all candidates already invited — skipping insert", { run_id });
    return { ok: true, newlyInvited: [] };
  }

  const inviteInsert = await admin.from("pickup_run_invites").insert(newRows);
  if (inviteInsert.error) return { ok: false, error: inviteInsert.error.message };

  console.log("[insertInvitesForTierRanks] insert ok", { run_id, inserted: newRows.length });

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
