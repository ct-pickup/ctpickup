import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPushPolicy } from "@/lib/push/pushPolicy";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { isTestTournamentSlug } from "@/lib/tournament/testTournament";

/**
 * The one "your tournament starts soon" push. Run hourly (vercel.json). What it says and who gets it:
 *
 *   Title  Tournament starts soon
 *   Body   <tournament title> starts <Sat, Nov 21 at 2:00 PM ET>.
 *   To     the captain of every team that has paid, and every player who accepted a place on one of those teams.
 *          Nobody else: not unpaid or rejected captains, invited players who have not accepted, or other players.
 *
 * WHEN: the first run in which the tournament starts within 25 hours. A player who is inside their quiet hours (or has reminders
 * switched off) is skipped without using up their reminder, so the next hourly run tries again, until 3 hours before the start.
 *
 * EXACTLY ONCE per player and tournament: the slot is claimed in the push ledger (claim_push_slots, atomic, one row per player
 * and tournament), then the push is sent to the players whose claim succeeded. A second run, the next hour, or two runs at the same
 * time, claim nothing and send nothing. No ledger means no reminder (never risk a second one).
 *
 * NEVER: a tournament that is not live (is_active false), is canceled, has finished, has no start time, or has a slug starting
 * "test-". Sends nothing for a start time in the past.
 */

export const TOURNAMENT_REMINDER_KIND = "tournament_starts_soon";
export const TOURNAMENT_REMINDER_BUCKET = "tournament_start_reminder";
export const TOURNAMENT_REMINDER_TITLE = "Tournament starts soon";
/** The first run inside this long before the start sends the reminder. */
export const REMINDER_OPENS_BEFORE_START_MS = 25 * 60 * 60 * 1000;
/** Players skipped for quiet hours keep being tried until the start is this close. */
export const REMINDER_CLOSES_BEFORE_START_MS = 3 * 60 * 60 * 1000;

export type TournamentReminderResult = { tournaments: number; considered: number; allowed: number; claimed: number; sent: number };

/** "Sat, Nov 21 at 2:00 PM ET". Eastern time, because every tournament start in the app is entered and shown in Eastern time. */
export function startTimeText(startAtIso: string): string {
  const d = new Date(startAtIso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;
}

export function tournamentReminderBody(title: string, startAtIso: string): string {
  const name = title.trim() || "Your tournament";
  return `${name} starts ${startTimeText(startAtIso)}.`;
}

type TournamentRow = { id: string; title: string | null; slug: string | null; start_at: string | null; is_active: boolean | null; canceled_at?: string | null };

export async function sendTournamentStartReminders(admin: SupabaseClient, now: number = Date.now()): Promise<TournamentReminderResult> {
  const result: TournamentReminderResult = { tournaments: 0, considered: 0, allowed: 0, claimed: 0, sent: 0 };

  const { data, error } = await admin
    .from("tournaments")
    .select("id,title,slug,start_at,is_active,canceled_at")
    .eq("is_active", true)
    .is("canceled_at", null)
    .not("start_at", "is", null);
  if (error) return result;

  for (const t of (data ?? []) as TournamentRow[]) {
    if (t.is_active !== true || t.canceled_at) continue;
    if (isTestTournamentSlug(t.slug)) continue;
    const startMs = t.start_at ? Date.parse(t.start_at) : NaN;
    if (!Number.isFinite(startMs)) continue;
    const until = startMs - now;
    if (until > REMINDER_OPENS_BEFORE_START_MS || until < REMINDER_CLOSES_BEFORE_START_MS) continue;

    // A tournament whose final already has a result is over, whatever its start time says.
    const fin = await admin.from("tournament_matches").select("id").eq("tournament_id", t.id).eq("stage", "final").not("completed_at", "is", null).limit(1);
    if (!fin.error && (fin.data ?? []).length > 0) continue;

    const caps = await admin.from("tournament_captains").select("id,user_id").eq("tournament_id", t.id).in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]);
    if (caps.error) continue;
    const paid = (caps.data ?? []) as { id: string; user_id: string | null }[];
    const ids = new Set<string>();
    for (const c of paid) if (c.user_id) ids.add(String(c.user_id));
    if (paid.length) {
      const ros = await admin.from("tournament_roster").select("user_id").in("captain_id", paid.map((c) => String(c.id))).eq("status", "accepted");
      if (!ros.error) for (const r of (ros.data ?? []) as { user_id: string | null }[]) if (r.user_id) ids.add(String(r.user_id));
    }
    const recipients = [...ids];
    if (!recipients.length) continue;
    result.tournaments += 1;
    result.considered += recipients.length;

    // Their notification settings first (reminders switch, quiet hours): a skipped player is tried again next hour.
    let allowed: string[];
    try {
      allowed = (await applyPushPolicy(admin, recipients, "reminders", { now: new Date(now) })).allowed;
    } catch {
      continue;
    }
    result.allowed += allowed.length;
    if (!allowed.length) continue;

    const claim = await admin.rpc("claim_push_slots", {
      p_user_ids: allowed,
      p_bucket: TOURNAMENT_REMINDER_BUCKET,
      p_dedupe_key: `${TOURNAMENT_REMINDER_BUCKET}:${t.id}`,
      p_window_hours: 0,
    });
    if (claim.error || !Array.isArray(claim.data)) continue; // no ledger, no reminder
    const claimed = (claim.data as { user_id?: string }[]).map((r) => r.user_id).filter((id): id is string => typeof id === "string");
    if (!claimed.length) continue;
    result.claimed += claimed.length;

    const res = await sendPushToUsers(admin, claimed, {
      title: TOURNAMENT_REMINDER_TITLE,
      body: tournamentReminderBody(t.title ?? "", t.start_at as string),
      // The kind is written out here (not the constant) so the test that scans every tournament push for a guard key can see it.
      data: { kind: "tournament_starts_soon", tournament_id: t.id },
    });
    result.sent += res.tokens;

    // Informational only (the ledger above is what makes it once only): when the first reminder for this tournament went out.
    await admin.from("tournaments").update({ start_reminder_sent_at: new Date(now).toISOString() }).eq("id", t.id).is("start_reminder_sent_at", null);
  }
  return result;
}
