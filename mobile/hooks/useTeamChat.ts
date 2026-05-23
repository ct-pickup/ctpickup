import { useAuth } from "@/context/AuthContext";
import { useProfileApproval } from "@/hooks/useProfileApproval";
import { type ChatReactionGroup, postChatMessageViaApi } from "@/lib/chatApi";
import { CHAT_PROFANITY_USER_MESSAGE, messageContainsProfanity } from "@/lib/chatProfanity";
import { isAdminDmGroupSlug, type ChatMessageRow, type ChatRoomSummary } from "@/lib/teamChat";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChatRoomRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  room_type: string | null;
  is_active: boolean;
  announcements_only: boolean;
  closes_at: string | null;
  auto_close_at: string | null;
  created_at: string;
};

export type RoomLookup = { slug: string; id?: null } | { id: string; slug?: null };

export function useTeamChatRoom(enabled: boolean, lookup: RoomLookup) {
  const { supabase, session } = useAuth();
  const [room, setRoom] = useState<ChatRoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const slug = lookup.slug ? String(lookup.slug).trim() : "";
  const id = lookup.id ? String(lookup.id).trim() : "";

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
    if (!slug && !id) {
      setRoom(null);
      setLoading(false);
      setError("Missing room.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const base = supabase
        .from("chat_rooms")
        .select("id,slug,title,description,room_type,is_active,announcements_only,closes_at,auto_close_at,created_at");
      const query = id ? base.eq("id", id) : base.eq("slug", slug);
      const { data, error: qErr } = await query.maybeSingle();
      if (cancelled) return;
      if (qErr) {
        console.warn("[useTeamChatRoom] chat_rooms query failed", qErr.message ?? qErr);
        setError("Something went wrong. Please try again.");
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
  }, [enabled, supabase, session?.user, slug, id]);

  // Realtime: when an admin updates room settings (announcements_only,
  // is_active, closes_at, title), reflect the change immediately without a
  // manual refresh. We subscribe by `id` once we know it; for slug-only
  // lookups we wait for the initial fetch to resolve the id.
  const roomId = room?.id ?? null;
  useEffect(() => {
    if (!enabled || !supabase || !roomId) return;
    const channel = supabase
      .channel(`chat_rooms:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const next = payload.new as ChatRoomRow | null;
          if (next && next.id === roomId) {
            setRoom(next);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, supabase, roomId]);

  return { room, loading, error };
}

/** Matches `chat_messages_set_sender_display` (display name + `sender_is_admin`). */
function profileToChatSenderDisplay(first: string | null | undefined, last: string | null | undefined): string {
  const s = `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim();
  return s || "Player";
}

/** Case- and inner-whitespace-insensitive compare for chat sender labels. */
export function normalizeChatSenderDisplayForMatch(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Returns the set of user_ids whose profile has `is_admin = true`. Used by the
 * chat UI to identify staff-authored messages so they can be rendered with the
 * "announcement" pill (lime border + dark green card + white text) in any
 * room, not just announcements-only rooms.
 *
 * Also returns normalized display names for every admin profile (same string
 * shape as `chat_messages.sender_display_name`) so slug rooms can label staff
 * as "Admin" when the denormalized name matches.
 */
export function useChatAdminUserIds(enabled: boolean) {
  const { supabase } = useAuth();
  const [adminIds, setAdminIds] = useState<Set<string>>(() => new Set());
  const [adminSenderDisplayNorms, setAdminSenderDisplayNorms] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !supabase) {
      setAdminIds(new Set());
      setAdminSenderDisplayNorms(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase.from("profiles").select("id,first_name,last_name").eq("is_admin", true);
      if (cancelled) return;
      const ids = new Set<string>();
      const norms = new Set<string>();
      for (const row of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
        if (row?.id) ids.add(row.id);
        const fn = String(row.first_name ?? "").trim();
        const ln = String(row.last_name ?? "").trim();
        if (fn || ln) {
          norms.add(normalizeChatSenderDisplayForMatch(profileToChatSenderDisplay(row.first_name, row.last_name)));
        }
      }
      setAdminIds(ids);
      setAdminSenderDisplayNorms(norms);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supabase]);

  return { adminIds, adminSenderDisplayNorms, loading };
}

/**
 * Loads the set of user_ids the current player has blocked. Used by the chat
 * thread to filter messages client-side (per App Store Guideline 1.2). The
 * block list is fetched once when the chat thread mounts and refreshed on
 * demand via `reload`. Inserts to `chat_blocks` happen through the Next.js
 * `/api/chat/block` route — clients cannot write to the table directly (RLS).
 */
export function useChatBlockedUserIds(enabled: boolean) {
  const { supabase, session } = useAuth();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled || !supabase || !session?.user?.id) {
      setBlockedIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("chat_blocks")
      .select("blocked_user_id")
      .eq("blocker_user_id", session.user.id);
    const ids = new Set<string>();
    for (const row of (data ?? []) as { blocked_user_id: string | null }[]) {
      if (row?.blocked_user_id) ids.add(row.blocked_user_id);
    }
    setBlockedIds(ids);
    setLoading(false);
  }, [enabled, supabase, session?.user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const addLocal = useCallback((userId: string) => {
    setBlockedIds((prev) => {
      if (prev.has(userId)) return prev;
      const next = new Set(prev);
      next.add(userId);
      return next;
    });
  }, []);

  return { blockedIds, loading, reload: load, addLocal };
}

export function useTeamChatAccess() {
  const { session } = useAuth();
  const { approved, isAdmin, isReady } = useProfileApproval();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return { allowed: null as boolean | null, isAdmin: null as boolean | null };
  }

  if (!isReady) {
    return { allowed: null, isAdmin: null };
  }

  return { allowed: approved, isAdmin };
}

function aggregateReactionRowsForMessages(
  rows: { message_id: string; emoji: string; user_id: string }[],
  myUserId: string | null,
): Record<string, ChatReactionGroup[]> {
  const byMessage = new Map<string, Map<string, { count: number; reacted_by_me: boolean }>>();
  for (const row of rows) {
    const mid = row.message_id;
    if (!byMessage.has(mid)) byMessage.set(mid, new Map());
    const em = byMessage.get(mid)!;
    const e = String(row.emoji ?? "").trim();
    if (!e) continue;
    const cur = em.get(e) ?? { count: 0, reacted_by_me: false };
    cur.count += 1;
    if (myUserId && row.user_id === myUserId) cur.reacted_by_me = true;
    em.set(e, cur);
  }
  const out: Record<string, ChatReactionGroup[]> = {};
  for (const [mid, em] of byMessage) {
    out[mid] = [...em.entries()]
      .map(([emoji, v]) => ({ emoji, count: v.count, reacted_by_me: v.reacted_by_me }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.emoji.localeCompare(b.emoji);
      });
  }
  return out;
}

export function useTeamChatMessages(roomId: string | null) {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [reactionsByMessageId, setReactionsByMessageId] = useState<Record<string, ChatReactionGroup[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const roomMessageIdsRef = useRef<Set<string>>(new Set());
  roomMessageIdsRef.current = new Set(messages.map((m) => m.id));

  const refetchReactionsForMessage = useCallback(
    async (messageId: string) => {
      if (!supabase) return;
      const { data, error: rxErr } = await supabase.from("chat_reactions").select("emoji,user_id").eq("message_id", messageId);
      if (rxErr) return;
      const rows = (data ?? []).map((r) => {
        const row = r as { emoji: string; user_id: string };
        return { message_id: messageId, emoji: row.emoji, user_id: row.user_id };
      });
      const map = aggregateReactionRowsForMessages(rows, uid);
      const groups = map[messageId] ?? [];
      setReactionsByMessageId((prev) => ({ ...prev, [messageId]: groups }));
    },
    [supabase, uid],
  );

  const applyReactionGroupsFromServer = useCallback((messageId: string, groups: ChatReactionGroup[]) => {
    setReactionsByMessageId((prev) => ({ ...prev, [messageId]: groups }));
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !roomId) {
      setMessages([]);
      setReactionsByMessageId({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("chat_messages")
      .select("id,room_id,user_id,body,sender_display_name,sender_is_admin,created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (qErr) {
      console.warn("[useTeamChatMessages] chat_messages load failed", qErr.message ?? qErr);
      setError("Something went wrong. Please try again.");
      setMessages([]);
      setReactionsByMessageId({});
    } else {
      const list = (data ?? []) as ChatMessageRow[];
      setMessages(list);
      if (list.length === 0) {
        setReactionsByMessageId({});
      } else {
        const ids = list.map((m) => m.id);
        const rx = await supabase.from("chat_reactions").select("message_id,emoji,user_id").in("message_id", ids);
        if (rx.error) {
          setReactionsByMessageId({});
        } else {
          setReactionsByMessageId(
            aggregateReactionRowsForMessages((rx.data ?? []) as { message_id: string; emoji: string; user_id: string }[], uid),
          );
        }
      }
    }
    setLoading(false);
  }, [supabase, roomId, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !roomId) return;

    let ch: RealtimeChannel | null = null;

    ch = supabase
      .channel(`chat-messages:${roomId}`)
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessageRow;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .subscribe();

    return () => {
      if (ch) void supabase.removeChannel(ch);
    };
  }, [supabase, roomId]);

  useEffect(() => {
    if (!supabase || !roomId) return;

    const onReactionEvent = (messageId: string | undefined) => {
      if (!messageId || !roomMessageIdsRef.current.has(messageId)) return;
      void refetchReactionsForMessage(messageId);
    };

    const ch = supabase
      .channel(`chat-reactions:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_reactions" },
        (payload) => {
          onReactionEvent((payload.new as { message_id?: string })?.message_id);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_reactions" },
        (payload) => {
          onReactionEvent((payload.old as { message_id?: string })?.message_id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, roomId, refetchReactionsForMessage]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!roomId || !uid || trimmed.length === 0) return { ok: false as const, error: "missing" };
      if (!accessToken) return { ok: false as const, error: "missing" };
      if (messageContainsProfanity(trimmed)) return { ok: false as const, error: CHAT_PROFANITY_USER_MESSAGE };
      const api = await postChatMessageViaApi(accessToken, roomId, trimmed);
      if (!api.ok) {
        const msg = api.error?.includes("Profanity is not allowed") ? CHAT_PROFANITY_USER_MESSAGE : api.error;
        return { ok: false as const, error: msg };
      }
      return { ok: true as const };
    },
    [roomId, uid, accessToken],
  );

  return {
    messages,
    reactionsByMessageId,
    applyReactionGroupsFromServer,
    loading,
    error,
    reload: load,
    send,
    currentUserId: uid,
  };
}

/**
 * For staff, DM group rooms use the player's name in the UI; `chat_rooms.title` stays the admin
 * display name so players see staff in their list.
 */
export function useAdminDmPeerLabels(enabled: boolean, isAdmin: boolean, rooms: ChatRoomSummary[], myUserId: string | null) {
  const { supabase } = useAuth();
  const [labels, setLabels] = useState<Record<string, string>>({});

  const dmRoomIds = useMemo(() => {
    if (!isAdmin) return [];
    return rooms.filter((r) => r.room_type === "group" && isAdminDmGroupSlug(r.slug)).map((r) => r.id);
  }, [isAdmin, rooms]);

  useEffect(() => {
    if (!enabled || !isAdmin || !supabase || !myUserId || dmRoomIds.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: mems, error: mErr } = await supabase
        .from("chat_room_members")
        .select("room_id,user_id")
        .in("room_id", dmRoomIds);
      if (cancelled) return;
      if (mErr || !mems) {
        setLabels({});
        return;
      }
      const peerIdByRoom: Record<string, string> = {};
      for (const row of mems as { room_id: string; user_id: string }[]) {
        if (row.user_id !== myUserId) peerIdByRoom[row.room_id] = row.user_id;
      }
      const peerIds = [...new Set(Object.values(peerIdByRoom))];
      if (peerIds.length === 0) {
        setLabels({});
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", peerIds);
      if (cancelled) return;
      const nameById: Record<string, string> = {};
      for (const p of (profs ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
      }[]) {
        const n = `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim();
        nameById[p.id] = n || (p.username ? `@${p.username}` : "Player");
      }
      const out: Record<string, string> = {};
      for (const [roomId, peerId] of Object.entries(peerIdByRoom)) {
        out[roomId] = nameById[peerId] || "Player";
      }
      setLabels(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, isAdmin, supabase, myUserId, dmRoomIds]);

  return labels;
}
