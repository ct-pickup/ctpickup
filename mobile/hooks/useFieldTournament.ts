import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { fetchTournamentPublic } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

export type FieldTournamentTeamRow = {
  id: string;
  team_name: string;
  captain_name: string;
};

export type FieldTournamentSummary = {
  id: string;
  slug: string;
  title: string;
  targetTeams: number;
  officialThreshold: number;
  maxTeams: number;
  announcement: string | null;
  start_at?: string | null;
  venue?: string | null;
  service_region?: string | null;
  format_summary?: string | null;
  entry_fee_cents?: number;
};

export type FieldTournamentPayload = {
  tournament: FieldTournamentSummary | null;
  claimedTeams: number;
  confirmedTeams: number;
  finalConfirmedTeams?: number;
  official: boolean;
  full: boolean;
  teams?: FieldTournamentTeamRow[];
};

export function parseFieldPayload(json: unknown): FieldTournamentPayload | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const t = o.tournament;
  const claimedTeams = Number(o.claimedTeams ?? 0);
  const confirmedTeams = Number(o.confirmedTeams ?? 0);
  const official = Boolean(o.official);
  const full = Boolean(o.full);
  const finalConfirmedTeams = Number(o.finalConfirmedTeams ?? o.final_confirmed_teams ?? NaN);
  const teamsRaw = o.teams;
  let teams: FieldTournamentTeamRow[] | undefined;
  if (Array.isArray(teamsRaw)) {
    teams = teamsRaw
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const tr = row as Record<string, unknown>;
        return {
          id: String(tr.id ?? ""),
          team_name: String(tr.team_name ?? ""),
          captain_name: String(tr.captain_name ?? ""),
        };
      })
      .filter((x): x is FieldTournamentTeamRow => !!x && x.id.length > 0);
  }

  if (t === null || t === undefined) {
    return {
      tournament: null,
      claimedTeams,
      confirmedTeams,
      finalConfirmedTeams: Number.isFinite(finalConfirmedTeams) ? finalConfirmedTeams : undefined,
      official,
      full,
    };
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
      start_at: typeof tr.start_at === "string" ? tr.start_at : null,
      venue: typeof tr.venue === "string" && tr.venue.trim() ? tr.venue.trim() : null,
      service_region:
        tr.service_region != null && String(tr.service_region).trim()
          ? String(tr.service_region).trim().toUpperCase()
          : null,
      format_summary:
        typeof tr.format_summary === "string" && tr.format_summary.trim() ? tr.format_summary.trim() : null,
      entry_fee_cents:
        typeof tr.entry_fee_cents === "number" && Number.isFinite(tr.entry_fee_cents)
          ? tr.entry_fee_cents
          : undefined,
    },
    claimedTeams,
    confirmedTeams,
    finalConfirmedTeams: Number.isFinite(finalConfirmedTeams) ? finalConfirmedTeams : undefined,
    official,
    full,
    teams: teams && teams.length ? teams : undefined,
  };
}

export function useFieldTournament() {
  const { supabase, session } = useAuth();
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
    const r = await fetchTournamentPublic({ region, accessToken: session?.access_token ?? null });
    if (!r.ok) {
      setError("Could not load in-person tournament.");
      setPayload(null);
    } else {
      setPayload(parseFieldPayload(r.json));
    }
    setLoading(false);
  }, [region, regionReady, session?.access_token]);

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
