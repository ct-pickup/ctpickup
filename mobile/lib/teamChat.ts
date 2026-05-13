import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

/** Matches `chat_rooms.slug` seeded in migration `20260502160000_team_chat.sql`. */
export const TEAM_CHAT_SLUG = "team" as const;
export const ANNOUNCEMENTS_CHAT_SLUG = "announcements" as const;

export type ChatRoomType = "public" | "announcement" | "group";

/** Admin↔player DMs use `room_type: group` and slugs `dm` + 32 hex (see `lib/chat/adminDmRoom.ts`). */
const DM_GROUP_SLUG_RE = /^dm[a-f0-9]{32}$/i;

export function isAdminDmGroupSlug(slug: string): boolean {
  return DM_GROUP_SLUG_RE.test(String(slug || "").trim());
}

export type ChatMessageRow = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  sender_display_name: string;
  /** Mirrors `profiles.is_admin` at insert time; see `chat_messages_set_sender_display`. */
  sender_is_admin: boolean;
  created_at: string;
};

export type ChatRoomSummary = {
  id: string;
  slug: string;
  title: string;
  room_type: ChatRoomType;
  announcements_only: boolean;
  is_active: boolean;
};

/**
 * Lists every chat room the signed-in user can see. RLS on `chat_rooms` already
 * filters out group rooms the user isn't a member of, so the client just runs
 * a plain select. Returns rooms ordered by `created_at` so the seeded
 * Announcements / Team rooms come first, followed by any group rooms.
 */
export function useUserChatRooms(enabled: boolean) {
  const { supabase, session } = useAuth();
  const [rooms, setRooms] = useState<ChatRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !supabase || !session?.user?.id) {
      setRooms([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("chat_rooms")
        .select("id,slug,title,room_type,announcements_only,is_active")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRooms([]);
      } else {
        setRooms((data ?? []) as ChatRoomSummary[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supabase, session?.user?.id]);

  return { rooms, loading, error };
}
