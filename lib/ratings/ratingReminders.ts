import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPushPolicy } from "@/lib/push/pushPolicy";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { loadPendingRatings, ratingGateActive, readRatingFlag } from "@/lib/ratings/pendingRating";
import { RATING_REMINDER_AFTER_MS } from "@/shared/ratingGate";

/** The one reminder: kind, ledger bucket and wording. */
export const RATING_REMINDER_KIND = "rating_required_reminder";
export const RATING_REMINDER_BUCKET = "rating_reminder";
export const RATING_REMINDER_TITLE = "Rate your last game";
export const RATING_REMINDER_BODY = "Rate your last game to join your next one. It only takes a few seconds.";

export type RatingReminderResult = { considered: number; claimed: number; sent: number };

/**
 * One push, 24 hours after kickoff, only to a player whose rating is still pending, and never a second one.
 *
 * Run hourly. For every game whose kickoff was between 24 and 72 hours ago, the players who still owe a ballot are found with the
 * same rule that blocks them (lib/ratings/pendingRating.ts), so a ballot submitted in the meantime cancels the reminder. The slot is
 * claimed in the push ledger (claim_push_slots, one row per player and game, atomic), which is what makes it once only: an hour
 * later the claim is already there. A player inside their quiet hours, or with reminders switched off, is skipped without claiming,
 * so the next hourly run tries again while the window is still open. Admins are exempt and never reminded. Flag off: nothing.
 */
export async function sendRatingReminders(admin: SupabaseClient, now: number = Date.now()): Promise<RatingReminderResult> {
  const result: RatingReminderResult = { considered: 0, claimed: 0, sent: 0 };

  const flag = await readRatingFlag(admin);
  if (!flag || (flag.enabled !== true && !(Array.isArray(flag.allowlist) && flag.allowlist.length > 0))) return result;

  const pending = await loadPendingRatings(admin, { now, minAgeMs: RATING_REMINDER_AFTER_MS });
  if (!pending.length) return result;

  const userIds = [...new Set(pending.map((p) => p.user_id))];
  const admins = new Set<string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin.from("profiles").select("id").in("id", userIds.slice(i, i + 200)).eq("is_admin", true);
    for (const r of (data ?? []) as { id: string }[]) admins.add(r.id);
  }
  const eligible = pending.filter((p) => ratingGateActive(flag, p.user_id, admins.has(p.user_id)));
  result.considered = eligible.length;
  if (!eligible.length) return result;

  const byRun = new Map<string, string[]>();
  for (const p of eligible) byRun.set(p.rating.run_id, [...(byRun.get(p.rating.run_id) ?? []), p.user_id]);

  for (const [runId, users] of byRun) {
    // Their notification settings first (reminders switch, quiet hours), so a skipped player is tried again next hour.
    let allowed: string[];
    try {
      allowed = (await applyPushPolicy(admin, users, "reminders", { now: new Date(now) })).allowed;
    } catch {
      continue;
    }
    if (!allowed.length) continue;

    const claim = await admin.rpc("claim_push_slots", {
      p_user_ids: allowed,
      p_bucket: RATING_REMINDER_BUCKET,
      p_dedupe_key: `${RATING_REMINDER_BUCKET}:${runId}`,
      p_window_hours: 0,
    });
    if (claim.error || !Array.isArray(claim.data)) continue; // no ledger, no reminder: never risk a second one
    const claimed = (claim.data as { user_id?: string }[]).map((r) => r.user_id).filter((id): id is string => typeof id === "string");
    if (!claimed.length) continue;
    result.claimed += claimed.length;

    const res = await sendPushToUsers(admin, claimed, {
      title: RATING_REMINDER_TITLE,
      body: RATING_REMINDER_BODY,
      data: { kind: RATING_REMINDER_KIND, screen: `session/${runId}`, run_id: runId, url: `ctpickup://session/${runId}` },
    });
    result.sent += res.tokens;
  }
  return result;
}
