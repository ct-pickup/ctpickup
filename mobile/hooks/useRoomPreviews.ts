import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/context/AuthContext";

export type RoomPreview = {
  /** Last message body, trimmed to one line by the row. */
  body: string;
  /** ISO timestamp of the last message. */
  at: string;
  senderName: string;
  senderAvatarUrl: string | null;
  unread: boolean;
};

/**
 * Last message and unread state for each room, straight from chat_messages and
 * the member's last_read_at. Rooms with no messages are absent from the map, so
 * a row falls back to its static subtitle rather than showing a blank preview.
 *
 * Degrades to an empty map on any error, including last_read_at not existing
 * before the inbox migration runs.
 */
export function useRoomPreviews(roomIds: string[]): Map<string, RoomPreview> {
  const { session, supabase } = useAuth();
  const userId = session?.user?.id ?? null;
  const [previews, setPreviews] = useState<Map<string, RoomPreview>>(new Map());
  const key = roomIds.join(",");

  useFocusEffect(
    useCallback(() => {
      const ids = key ? key.split(",") : [];
      if (!supabase || !userId || ids.length === 0) {
        setPreviews(new Map());
        return;
      }

      let cancelled = false;

      void (async () => {
        // Newest first across all the viewer's rooms; the first row per room wins.
        const msgs = await supabase
          .from("chat_messages")
          .select("id,room_id,user_id,body,sender_display_name,created_at")
          .in("room_id", ids)
          .order("created_at", { ascending: false })
          .limit(400);
        if (cancelled || msgs.error || !msgs.data) return;

        const members = await supabase
          .from("chat_room_members")
          .select("room_id,last_read_at")
          .eq("user_id", userId)
          .in("room_id", ids);
        if (cancelled) return;

        const lastRead = new Map<string, string | null>();
        if (!members.error) {
          for (const row of members.data as Array<{ room_id: string; last_read_at: string | null }>) {
            lastRead.set(row.room_id, row.last_read_at);
          }
        }

        const senderIds = new Set<string>();
        const latest = new Map<string, { room_id: string; user_id: string; body: string; sender_display_name: string; created_at: string }>();
        for (const row of msgs.data as Array<{
          room_id: string;
          user_id: string;
          body: string;
          sender_display_name: string;
          created_at: string;
        }>) {
          if (!latest.has(row.room_id)) {
            latest.set(row.room_id, row);
            senderIds.add(row.user_id);
          }
        }

        const avatars = new Map<string, string | null>();
        if (senderIds.size) {
          const profs = await supabase.from("profiles").select("id,avatar_url").in("id", Array.from(senderIds));
          if (cancelled) return;
          if (!profs.error) {
            for (const row of profs.data as Array<{ id: string; avatar_url: string | null }>) {
              avatars.set(row.id, row.avatar_url);
            }
          }
        }

        const next = new Map<string, RoomPreview>();
        for (const [roomId, row] of latest) {
          const read = lastRead.get(roomId) ?? null;
          next.set(roomId, {
            body: row.body,
            at: row.created_at,
            senderName: row.sender_display_name,
            senderAvatarUrl: avatars.get(row.user_id) ?? null,
            unread: row.user_id !== userId && (!read || Date.parse(row.created_at) > Date.parse(read)),
          });
        }
        if (!cancelled) setPreviews(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [key, supabase, userId]),
  );

  return previews;
}
