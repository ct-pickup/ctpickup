import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { fetchTournamentPublic } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

export type FieldTournamentSummary = {
  id: string;
  slug: string;
  title: string;
  targetTeams: number;
  officialThreshold: number;
  maxTeams: number;
  announcement: string | null;
};

export type FieldTournamentPayload = {
  tournament: FieldTournamentSummary | null;
  claimedTeams: number;
  confirmedTeams: number;
  official: boolean;
  full: boolean;
};

export function parseFieldPayload(json: unknown): FieldTournamentPayload | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const t = o.tournament;
  const claimedTeams = Number(o.claimedTeams ?? 0);
  const confirmedTeams = Number(o.confirmedTeams ?? 0);
  const official = Boolean(o.official);
  const full = Boolean(o.full);

  if (t === null || t === undefined) {
    return { tournament: null, claimedTeams, confirmedTeams, official, full };
  }
  if (typeof t !== "object") return null;
  const tr = t as Record<string, unknown>;
  return {
    tournament: {
      id: String(tr.id ?? ""),
      slug: String(tr.slug ?? ""),
      title: String(tr.title ?? "Field tournament"),
      targetTeams: Number(tr.targetTeams ?? tr.target_teams ?? 0),
      officialThreshold: Number(tr.officialThreshold ?? tr.official_threshold ?? 0),
      maxTeams: Number(tr.maxTeams ?? tr.max_teams ?? 0),
      announcement:
        typeof tr.announcement === "string" && tr.announcement.trim()
          ? tr.announcement.trim()
          : null,
    },
    claimedTeams,
    confirmedTeams,
    official,
    full,
  };
}

export function useFieldTournament() {
  const { supabase } = useAuth();
  const { region, ready: regionReady } = useSelectedRegion();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<FieldTournamentPayload | null>(null);

  const reload = useCallback(async () => {
    if (!siteOrigin()) {
      setError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      setPayload(null);
      setLoading(false);
      return;
    }
    if (!regionReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchTournamentPublic({ region });
    if (!r.ok) {
      setError("Could not load in-person tournament.");
      setPayload(null);
    } else {
      setPayload(parseFieldPayload(r.json));
    }
    setLoading(false);
  }, [region, regionReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tournamentId = payload?.tournament?.id?.trim() ? payload.tournament.id : null;

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!supabase || !tournamentId) return;

    const topic = `field-tournament:${tournamentId}`;
    const realtimeTopic = `realtime:${topic}`;
    let cancelled = false;
    const subscribed = { current: null as RealtimeChannel | null };

    void (async () => {
      const stale = supabase.getChannels().find((c) => c.topic === realtimeTopic);
      if (stale) {
        await supabase.removeChannel(stale);
      }
      if (cancelled) return;

      const channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "tournaments",
            filter: `id=eq.${tournamentId}`,
          },
          () => {
            void reloadRef.current();
          },
        )
        .subscribe();

      if (cancelled) {
        await supabase.removeChannel(channel);
        return;
      }
      subscribed.current = channel;
    })();

    return () => {
      cancelled = true;
      const ch = subscribed.current;
      subscribed.current = null;
      if (ch) {
        void supabase.removeChannel(ch);
      }
    };
  }, [supabase, tournamentId]);

  return { loading, error, payload, reload };
}
