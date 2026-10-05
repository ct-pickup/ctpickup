import type { SupabaseClient } from "@supabase/supabase-js";

/** A mute is active when it never ends (null) or ends in the future. */
export function isMuteActive(mutedUntil: string | null | undefined, now: number = Date.now()): boolean {
  if (mutedUntil == null) return true;
  const t = Date.parse(mutedUntil);
  return Number.isFinite(t) && t > now;
}

/**
 * Users who have an active push mute on this chat. Returns an empty set when the table is missing (migration not run)
 * or the lookup fails: a chat message is then delivered, never silently dropped. Logs no user data.
 */
export async function activeMutedUserIds(
  admin: SupabaseClient,
  roomId: string,
  userIds?: readonly string[],
  now: number = Date.now(),
): Promise<Set<string>> {
  const muted = new Set<string>();
  let q = admin.from("chat_notification_mutes").select("user_id,muted_until").eq("room_id", roomId);
  if (userIds) {
    if (userIds.length === 0) return muted;
    q = q.in("user_id", [...userIds]);
  }
  const res = await q;
  if (res.error) {
    console.warn(JSON.stringify({ tag: "chat-mute", message: "mute lookup failed; sending anyway", code: res.error.code ?? null }));
    return muted;
  }
  for (const row of res.data ?? []) {
    const r = row as { user_id?: string; muted_until?: string | null };
    if (typeof r.user_id === "string" && isMuteActive(r.muted_until, now)) muted.add(r.user_id);
  }
  return muted;
}

/** The recipients who have not muted this chat. Only chat-message pushes go through this; system pushes never do. */
export async function filterUnmutedUserIds(
  admin: SupabaseClient,
  roomId: string,
  userIds: readonly string[],
  now: number = Date.now(),
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const muted = await activeMutedUserIds(admin, roomId, userIds, now);
  return muted.size === 0 ? [...userIds] : userIds.filter((id) => !muted.has(id));
}
