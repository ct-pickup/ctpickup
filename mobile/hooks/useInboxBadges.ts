import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { fetchActiveMutes } from "@/lib/chatMute";
import { fetchNotifications } from "@/lib/notificationsApi";

export type InboxBadges = { messages: number; notifications: number };

const NONE: InboxBadges = { messages: 0, notifications: 0 };

/**
 * Unread counts for the two Home header icons.
 *
 * Messages come straight from Supabase: rows in chat_messages newer than the
 * member's last_read_at, written by someone else. Notifications come from
 * /api/notifications, which compares each alert against the read watermark.
 *
 * Both degrade to zero rather than throwing, so a missing column before the
 * inbox migration runs just means no badge.
 */
export function useInboxBadges(): InboxBadges {
  const { session, supabase } = useAuth();
  const userId = session?.user?.id ?? null;
  const token = session?.access_token ?? null;
  const [badges, setBadges] = useState<InboxBadges>(NONE);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setBadges(NONE);
        return;
      }

      let cancelled = false;

      const countMessages = async (): Promise<number> => {
        if (!supabase) return 0;
        const members = await supabase
          .from("chat_room_members")
          .select("room_id,last_read_at")
          .eq("user_id", userId);
        if (members.error || !members.data?.length) return 0;

        // A muted chat stays quiet: its unread messages show in the list but do not add to this count.
        const muted = await fetchActiveMutes(supabase, userId);
        let total = 0;
        for (const row of members.data as Array<{ room_id: string; last_read_at: string | null }>) {
          if (muted.has(row.room_id)) continue;
          let q = supabase
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("room_id", row.room_id)
            .neq("user_id", userId);
          if (row.last_read_at) q = q.gt("created_at", row.last_read_at);
          const res = await q;
          if (!res.error) total += res.count ?? 0;
        }
        return total;
      };

      const countNotifications = async (): Promise<number> => {
        if (!token) return 0;
        try {
          return (await fetchNotifications(token)).unread;
        } catch {
          return 0;
        }
      };

      void (async () => {
        const [messages, notifications] = await Promise.all([
          countMessages().catch(() => 0),
          countNotifications(),
        ]);
        if (!cancelled) setBadges({ messages, notifications });
      })();

      return () => {
        cancelled = true;
      };
    }, [supabase, token, userId]),
  );

  return badges;
}
