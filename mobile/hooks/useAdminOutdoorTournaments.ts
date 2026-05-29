import {
  fetchAdminOutdoorTournaments,
  type AdminOutdoorTournament,
  type TournamentCaptainRow,
  type TourneySubmissionRow,
} from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

type State = {
  loading: boolean;
  error: string | null;
  tournaments: AdminOutdoorTournament[];
  activeTournament: Record<string, unknown> | null;
  captains: TournamentCaptainRow[];
  submissions: TourneySubmissionRow[];
  prizePoolCents: number | null;
  panelError: string | null;
  reload: () => void;
};

/**
 * @param region Hub code (NY/CT/NJ/MD) to filter the tournament list, or undefined for all.
 * @param submissionDecision Filter signups when `includePanel` is true (`pending`, etc.), or undefined for all.
 */
export function useAdminOutdoorTournaments(
  region: string | undefined,
  submissionDecision: string | undefined,
  includePanel = true,
): State {
  const { session, isReady } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<AdminOutdoorTournament[]>([]);
  const [activeTournament, setActiveTournament] = useState<Record<string, unknown> | null>(null);
  const [captains, setCaptains] = useState<TournamentCaptainRow[]>([]);
  const [submissions, setSubmissions] = useState<TourneySubmissionRow[]>([]);
  const [prizePoolCents, setPrizePoolCents] = useState<number | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isReady) return;
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      setError("Not signed in.");
      setTournaments([]);
      setActiveTournament(null);
      setCaptains([]);
      setSubmissions([]);
      setPanelError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPanelError(null);

    void (async () => {
      try {
        const r = await fetchAdminOutdoorTournaments(token, {
          region,
          includePanel,
          submissionDecision,
        });
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          setTournaments([]);
          setActiveTournament(null);
          setCaptains([]);
          setSubmissions([]);
          return;
        }
        const d = r.data;
        setTournaments(Array.isArray(d.tournaments) ? d.tournaments : []);
        if (includePanel) {
          setActiveTournament((d.active_tournament as Record<string, unknown> | null | undefined) ?? null);
          setCaptains(Array.isArray(d.captains) ? (d.captains as TournamentCaptainRow[]) : []);
          setSubmissions(Array.isArray(d.submissions) ? (d.submissions as TourneySubmissionRow[]) : []);
          setPrizePoolCents(typeof d.prize_pool_cents === "number" ? d.prize_pool_cents : null);
          setPanelError(typeof d.panel_error === "string" ? d.panel_error : null);
        } else {
          setActiveTournament(null);
          setCaptains([]);
          setSubmissions([]);
          setPrizePoolCents(null);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setTournaments([]);
        setActiveTournament(null);
        setCaptains([]);
        setSubmissions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, session?.access_token, nonce, region, submissionDecision, includePanel]);

  return { loading, error, tournaments, activeTournament, captains, submissions, prizePoolCents, panelError, reload };
}
