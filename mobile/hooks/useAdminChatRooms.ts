import { fetchAdminChatRooms, type ChatRoom } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

type State = {
  loading: boolean;
  error: string | null;
  rooms: ChatRoom[];
  reload: () => void;
};

export function useAdminChatRooms(): State {
  const { session, isReady } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      setError("Not signed in.");
      setRooms([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const r = await fetchAdminChatRooms(token);
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setRooms([]);
          return;
        }
        const roomsRaw = (r.data as { rooms?: unknown }).rooms;
        setRooms(Array.isArray(roomsRaw) ? (roomsRaw as ChatRoom[]) : []);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setRooms([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, nonce]);

  return { loading, error, rooms, reload };
}

