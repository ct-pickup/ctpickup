import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { clearChatMute, fetchActiveMutes, muteUntilFor, setChatMute, type MuteChoice } from "@/lib/chatMute";

/** The chats the player has muted right now (room id to end time, null = until turned off). Refreshes on focus. */
export function useChatMutes(): Map<string, string | null> {
  const { session, supabase } = useAuth();
  const userId = session?.user?.id ?? null;
  const [mutes, setMutes] = useState<Map<string, string | null>>(new Map());

  useFocusEffect(
    useCallback(() => {
      if (!supabase || !userId) {
        setMutes(new Map());
        return;
      }
      let live = true;
      void fetchActiveMutes(supabase, userId).then((m) => {
        if (live) setMutes(m);
      });
      return () => {
        live = false;
      };
    }, [supabase, userId]),
  );

  return mutes;
}

/** One chat's mute: whether it is muted now, plus mute and unmute. Changes show at once and roll back on failure. */
export function useRoomMute(roomId: string | null) {
  const { session, supabase } = useAuth();
  const userId = session?.user?.id ?? null;
  const mutes = useChatMutes();
  // A just-made change, held until the next focus reload agrees with it.
  const [local, setLocal] = useState<{ roomId: string; muted: boolean; until: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = roomId && local?.roomId === roomId ? local : null;
  const stored = roomId && mutes.has(roomId);
  const muted = mine ? mine.muted : !!stored;
  const mutedUntil = mine ? mine.until : roomId ? (mutes.get(roomId) ?? null) : null;

  const mute = useCallback(
    async (choice: MuteChoice) => {
      if (!supabase || !userId || !roomId || busy) return false;
      setBusy(true);
      setError(null);
      const until = muteUntilFor(choice);
      const ok = await setChatMute(supabase, userId, roomId, until);
      if (ok) setLocal({ roomId, muted: true, until });
      else setError("Couldn't update this chat. Please try again.");
      setBusy(false);
      return ok;
    },
    [busy, roomId, supabase, userId],
  );

  const unmute = useCallback(async () => {
    if (!supabase || !userId || !roomId || busy) return false;
    setBusy(true);
    setError(null);
    const ok = await clearChatMute(supabase, userId, roomId);
    if (ok) setLocal({ roomId, muted: false, until: null });
    else setError("Couldn't update this chat. Please try again.");
    setBusy(false);
    return ok;
  }, [busy, roomId, supabase, userId]);

  return { muted, mutedUntil, busy, error, mute, unmute };
}
