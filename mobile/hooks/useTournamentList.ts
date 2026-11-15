import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useScreenActive } from "@/hooks/useScreenActive";
import { siteOrigin } from "@/lib/env";
import { fetchTournamentList } from "@/lib/siteApi";
import { parseTournamentList, type TournamentListItem } from "@/lib/tournamentEntryCore";

/** How often the list is refreshed while its screen is on screen, so a Live tag shows up without a pull. */
const POLL_MS = 30_000;

/**
 * Live tournaments and the current time, for the Home card and the Events tab. Loads when the screen comes into view and then every 30 seconds, and stops
 * when the screen is not the focused one or the app is in the background. A failed refresh keeps what was already shown.
 */
export function useTournamentList(): { items: TournamentListItem[]; now: number } {
  const { session } = useAuth();
  const token = session?.access_token;
  const active = useScreenActive();
  const [items, setItems] = useState<TournamentListItem[]>([]);
  /** The clock the show and hide rules use. It moves forward with every refresh, so a card disappears or appears on time. */
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef<Promise<void> | null>(null);

  const load = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    if (!token || !siteOrigin()) return Promise.resolve();
    const p = (async () => {
      try {
        const r = await fetchTournamentList(token);
        if (r.ok) setItems(parseTournamentList(r.json));
        setNow(Date.now());
      } catch {
        // Offline or a bad response: keep the last list.
      }
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [token]);

  useEffect(() => {
    if (!active || !token) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, token, load]);

  return { items, now };
}
