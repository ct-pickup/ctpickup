import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBadges, isVerifiedLevel, type BadgeStatus } from "@/shared/badges";
import { loadPlayerRecord } from "@/lib/records/playerRecord";

/**
 * Badges for one player from existing data: the record helper (games, streak, POTD), profiles.verification_level,
 * pickup_runs.created_by (hosted games that went ahead) and referral_events. Separate queries merged in JS; no new counters.
 * A failed side read counts as "not earned" so one missing table never hides the rest.
 */

const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

type HostedRun = { start_at: string | null; status: string | null };

/** Pure: hosted runs that went ahead (completed, or kicked off more than the live window ago, and not canceled). */
export function countHostedGames(runs: HostedRun[], now = Date.now()): number {
  let n = 0;
  for (const r of runs) {
    const st = (r.status ?? "").trim().toLowerCase();
    if (st === "canceled" || st === "cancelled") continue;
    if (st === "completed") {
      n += 1;
      continue;
    }
    const t = r.start_at ? Date.parse(r.start_at) : NaN;
    if (Number.isFinite(t) && t < now - LIVE_WINDOW_MS) n += 1;
  }
  return n;
}

async function hostedCount(admin: SupabaseClient, userId: string, now: number): Promise<number> {
  const { data, error } = await admin
    .from("pickup_runs")
    .select("start_at,status")
    .eq("created_by", userId)
    .order("start_at", { ascending: true })
    .limit(200);
  if (error) {
    console.warn("[badges] hosted runs unavailable:", error.message);
    return 0;
  }
  return countHostedGames((data ?? []) as HostedRun[], now);
}

async function referralCount(admin: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await admin
    .from("referral_events")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", userId);
  if (error) {
    console.warn("[badges] referral_events unavailable:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function verified(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("profiles").select("verification_level").eq("id", userId).maybeSingle();
  if (error) {
    console.warn("[badges] verification_level unavailable:", error.message);
    return false;
  }
  return isVerifiedLevel((data as { verification_level?: string | null } | null)?.verification_level);
}

export async function loadPlayerBadges(admin: SupabaseClient, userId: string, now = Date.now()): Promise<BadgeStatus[]> {
  const [record, isVerified, hosted, referrals] = await Promise.all([
    loadPlayerRecord(admin, userId, now),
    verified(admin, userId),
    hostedCount(admin, userId, now),
    referralCount(admin, userId),
  ]);
  return computeBadges({
    games: record.log,
    potdCount: record.potd_count,
    verified: isVerified,
    hostedCount: hosted,
    referralCount: referrals,
  });
}
