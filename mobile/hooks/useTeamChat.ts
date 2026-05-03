import { useAuth } from "@/context/AuthContext";
import { CHAT_PROFANITY_USER_MESSAGE, messageContainsProfanity } from "@/lib/chatProfanity";
import { type ChatMessageRow } from "@/lib/teamChat";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

export type ChatRoomRow = {
  id: string;
  slug: string;
  title: string;
  is_active: boolean;
  announcements_only: boolean;
  closes_at: string | null;
  created_at: string;
};

export function useTeamChatRoom(enabled: boolean, roomSlug: string) {
  const { supabase, session } = useAuth();
  const [room, setRoom] = useState<ChatRoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRoom(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (!supabase || !session?.user) {
      setRoom(null);
      setLoading(false);
      setError(null);
      return;
    }
    const slug = String(roomSlug || "").trim();
    if (!slug) {
      setRoom(null);
      setLoading(false);
      setError("Missing room.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("chat_rooms")
        .select("id,slug,title,is_active,announcements_only,closes_at,created_at")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRoom(null);
      } else if (data?.id) {
        setRoom(data as ChatRoomRow);
      } else {
        setError(null);
        setRoom(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supabase, session?.user, roomSlug]);

  return { room, loading, error };
}

export function useTeamChatAccess() {
  const { supabase, session } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setAllowed(null);
      setIsAdmin(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("profiles").select("approved,is_admin").eq("id", session.user.id).maybeSingle();
      if (cancelled) return;
      const admin = !!(data && data.is_admin === true);
      const ok = !!(data && (data.approved === true || admin));
      setIsAdmin(admin);
      setAllowed(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id]);

  return { allowed, isAdmin };
}

export function useTeamChatMessages(roomId: string | null) {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !roomId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("chat_messages")
      .select("id,room_id,user_id,body,sender_display_name,created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (qErr) {
      setError(qErr.message);
      setMessages([]);
    } else {
      setMessages((data ?? []) as ChatMessageRow[]);
    }
    setLoading(false);
  }, [supabase, roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !roomId) return;

    let ch: RealtimeChannel | null = null;

    ch = supabase
      .channel(`chat_messages:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();

    return () => {
      if (ch) void supabase.removeChannel(ch);
    };
  }, [supabase, roomId]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!supabase || !roomId || !uid || trimmed.length === 0) return { ok: false as const, error: "missing" };
      if (messageContainsProfanity(trimmed)) return { ok: false as const, error: CHAT_PROFANITY_USER_MESSAGE };
      const { error: insErr } = await supabase.from("chat_messages").insert({
        room_id: roomId,
        user_id: uid,
        body: trimmed,
      });
      if (insErr) {
        const msg = insErr.message?.includes("Profanity is not allowed") ? CHAT_PROFANITY_USER_MESSAGE : insErr.message;
        return { ok: false as const, error: msg };
      }
      return { ok: true as const };
    },
    [supabase, roomId, uid],
  );

  return {
    messages,
    loading,
    error,
    reload: load,
    send,
    currentUserId: uid,
  };
}
