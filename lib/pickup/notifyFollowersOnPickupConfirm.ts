import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_PROFILE_ROW, profileDisplayName } from "@/lib/profileFields";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

/**
 * When `playerId` newly confirms for `runId`, notify followers of that player who are
 * already confirmed on the same run.
 */
export async function notifyFollowersWhenFollowedPlayerConfirmsRun(
  admin: SupabaseClient,
  opts: { runId: string; playerId: string },
): Promise<void> {
  const { runId, playerId } = opts;
  if (!runId || !playerId) return;

  const followsRes = await admin
    .from("player_follows")
    .select("follower_id")
    .eq("following_id", playerId);
  if (followsRes.error) {
    console.error("[player_follow] list followers failed:", followsRes.error.message);
    return;
  }
  const followerIds = (followsRes.data ?? [])
    .map((r) => (r as { follower_id?: unknown }).follower_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!followerIds.length) return;

  const rsvpRes = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", runId)
    .eq("status", "confirmed")
    .in("user_id", followerIds);
  if (rsvpRes.error) {
    console.error("[player_follow] list confirmed followers on run failed:", rsvpRes.error.message);
    return;
  }
  const notifyIds = (rsvpRes.data ?? [])
    .map((r) => (r as { user_id?: unknown }).user_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!notifyIds.length) return;

  const profRes = await admin
    .from("profiles")
    .select("first_name,last_name,username")
    .eq("id", playerId)
    .maybeSingle();
  const row = profRes.data as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
  const display =
    profileDisplayName(
      row
        ? {
            ...EMPTY_PROFILE_ROW,
            first_name: row.first_name ?? null,
            last_name: row.last_name ?? null,
            username: row.username ?? null,
          }
        : null,
    ).trim() ||
    (typeof row?.username === "string" && row.username.trim() ? row.username.trim() : "") ||
    "Someone";

  await sendPushToUsers(admin, notifyIds, {
    title: `${display} joined the run 👋`,
    body: "Someone you follow just confirmed for the same run.",
    data: { kind: "player_followed_joined", run_id: runId, player_id: playerId },
  });
}
