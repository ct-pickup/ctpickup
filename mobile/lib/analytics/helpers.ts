import { useEffect, useRef } from "react";

import { track } from "@/lib/analytics/analytics";
import { reasonsProp } from "@/lib/analytics/reasonCodes";

/** Sends one event when the screen first shows (and again if `key` changes), not on every re-render. */
export function useTrackOnce(name: string, key: string | null, properties?: Record<string, string | number | boolean>): void {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (key === null || sent.current === key) return;
    sent.current = key;
    track(name, properties);
    // properties are only read when the key changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
}

const shown = new Set<string>();

/** recommendation_shown once per game per app session, at most 10 at a time. */
export function trackRecommendationsShown(games: { id: string; reasons?: string[] }[], listKind: string): void {
  games.slice(0, 10).forEach((g, i) => {
    if (shown.has(g.id)) return;
    shown.add(g.id);
    const reasons = reasonsProp(g.reasons);
    track("recommendation_shown", { run_id: g.id, rank: i + 1, list_kind: listKind, ...(reasons ? { reasons } : {}) });
  });
}

export function trackRecommendationTapped(game: { id: string; reasons?: string[] }, rank: number, listKind: string): void {
  const reasons = reasonsProp(game.reasons);
  track("recommendation_tapped", { run_id: game.id, rank, list_kind: listKind, ...(reasons ? { reasons } : {}) });
}
