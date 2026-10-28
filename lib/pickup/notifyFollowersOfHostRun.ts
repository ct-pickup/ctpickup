import type { SupabaseClient } from "@supabase/supabase-js";

import { claimAlertSlots } from "@/lib/alerts/fieldAlerts";
import { usersWithFlagOn } from "@/lib/flags";
import { etSlot, slotLabel } from "@/lib/pickup/repeatGame";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

/** At most one push per follower per host per day, however many games the host posts. */
export const HOST_FOLLOW_WINDOW_HOURS = 24;
const MAX_FOLLOWERS = 5000;

export const hostNewRunCopy = (hostName: string, label: string, region: string | null) => ({
  title: `${hostName} posted a game`,
  body: region ? `${label} in ${region}. You follow ${hostName}.` : `${label}. You follow ${hostName}.`,
});

/**
 * A host a player follows posts a public game: push the followers. Gated by the 'host_follow_alerts' flag per follower (fails closed),
 * then 1 push per follower per host per day, then the push policy (category switches and quiet hours) inside sendPushToUsers.
 * Reuses the player_follows table. Private (invite-only) games are never announced. Returns the followers who were pushed so the
 * caller can leave them out of the general new-game pushes. Never throws.
 */
export async function notifyFollowersOfHostRun(
  admin: SupabaseClient,
  args: { hostId: string; hostName: string; run: { id: string; start_at: string; time_tbd: boolean; inviteOnly: boolean; region: string | null }; skip?: Iterable<string> },
): Promise<string[]> {
  try {
    if (args.run.inviteOnly) return [];
    const skip = new Set<string>([args.hostId, ...(args.skip ?? [])]);
    const { data, error } = await admin.from("player_follows").select("follower_id").eq("following_id", args.hostId).limit(MAX_FOLLOWERS);
    if (error) return [];
    const followers = [...new Set((data ?? []).map((r) => (r as { follower_id?: string }).follower_id).filter((id): id is string => typeof id === "string" && !skip.has(id)))];
    if (!followers.length) return [];
    const allowed = await usersWithFlagOn(admin, "host_follow_alerts", followers);
    if (!allowed.length) return [];
    const { data: profs } = await admin.from("profiles").select("id,approved").in("id", allowed);
    const approved = ((profs ?? []) as { id: string; approved?: boolean }[]).filter((p) => p.approved === true).map((p) => p.id);
    const claimed = await claimAlertSlots(admin, approved, `host_new_run:${args.hostId}`, `run:${args.run.id}`, HOST_FOLLOW_WINDOW_HOURS);
    if (!claimed.length) return [];
    const slot = etSlot(args.run.start_at, args.run.time_tbd);
    const copy = hostNewRunCopy(args.hostName, slot ? slotLabel(slot.date, slot.time) : "A new game", args.run.region);
    await sendPushToUsers(admin, claimed, {
      ...copy,
      data: { kind: "host_new_run", screen: `session/${args.run.id}`, run_id: args.run.id, host_id: args.hostId, url: `ctpickup://session/${args.run.id}` },
    });
    return claimed;
  } catch (e) {
    console.error("[host-follow] failed", e instanceof Error ? e.message : "unknown");
    return [];
  }
}
