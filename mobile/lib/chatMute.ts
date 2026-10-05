import type { SupabaseClient } from "@supabase/supabase-js";

/** A player's own push mute for one chat (chat_notification_mutes). `until` null means until they turn it back on. */
export type MuteChoice = "1h" | "8h" | "1w" | "forever";

export const MUTE_CHOICES: Array<{ id: MuteChoice; label: string }> = [
  { id: "1h", label: "Mute for 1 hour" },
  { id: "8h", label: "Mute for 8 hours" },
  { id: "1w", label: "Mute for 1 week" },
  { id: "forever", label: "Until I turn it back on" },
];

const HOUR_MS = 3_600_000;

/** ISO end time for a choice, or null for "until I turn it back on". */
export function muteUntilFor(choice: MuteChoice, now: number = Date.now()): string | null {
  if (choice === "forever") return null;
  const hours = choice === "1h" ? 1 : choice === "8h" ? 8 : 24 * 7;
  return new Date(now + hours * HOUR_MS).toISOString();
}

/** Active while it never ends (null) or ends in the future. */
export function isMuteActive(mutedUntil: string | null | undefined, now: number = Date.now()): boolean {
  if (mutedUntil == null) return true;
  const t = Date.parse(mutedUntil);
  return Number.isFinite(t) && t > now;
}

/** "Muted until Fri, Oct 9, 3:00 PM" (Eastern), or "Muted until you turn it back on". */
export function muteStatusText(mutedUntil: string | null): string {
  if (mutedUntil == null) return "Muted until you turn it back on";
  const when = new Date(mutedUntil).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Muted until ${when}`;
}

/** The player's active mutes by room id. Empty on any error, including the table not existing yet. */
export async function fetchActiveMutes(supabase: SupabaseClient, userId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const res = await supabase.from("chat_notification_mutes").select("room_id,muted_until").eq("user_id", userId);
  if (res.error) return out;
  for (const row of (res.data ?? []) as Array<{ room_id: string; muted_until: string | null }>) {
    if (isMuteActive(row.muted_until)) out.set(row.room_id, row.muted_until);
  }
  return out;
}

/** Mutes (or changes) the mute for a chat. Muting twice just updates the row. Resolves false on failure. */
export async function setChatMute(supabase: SupabaseClient, userId: string, roomId: string, until: string | null): Promise<boolean> {
  const { error } = await supabase
    .from("chat_notification_mutes")
    .upsert({ user_id: userId, room_id: roomId, muted_until: until }, { onConflict: "user_id,room_id" });
  return !error;
}

export async function clearChatMute(supabase: SupabaseClient, userId: string, roomId: string): Promise<boolean> {
  const { error } = await supabase.from("chat_notification_mutes").delete().eq("user_id", userId).eq("room_id", roomId);
  return !error;
}
