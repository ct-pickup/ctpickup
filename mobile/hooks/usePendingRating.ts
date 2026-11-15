import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { parsePendingRating, visiblePending } from "@/lib/pendingRatingCore";
import { fetchPendingRating } from "@/lib/siteApi";
import type { PendingRating } from "@shared/ratingGate";

const TICK_MS = 60_000;

/**
 * The game this player still has to rate, for the cards on Home and the Games tab. Asks the server when the screen comes into
 * view, and keeps "time left" fresh once a minute while it is. The server says none while the require_ratings flag is off for
 * them, and for admins, so with the flag off this is always null. A failed read keeps what was shown.
 */
export function usePendingRating(): { pending: PendingRating | null; now: number } {
  const { session } = useAuth();
  const token = session?.access_token;
  const [pending, setPending] = useState<PendingRating | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (!token || !siteOrigin() || inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetchPendingRating(token);
      if (r.ok) setPending(parsePendingRating(r.json));
      setNow(Date.now());
    } catch {
      // Offline: keep the last answer.
    } finally {
      inflight.current = false;
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => setNow(Date.now()), TICK_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  return { pending: visiblePending(pending, now), now };
}
