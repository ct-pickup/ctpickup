"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import PageTop from "@/components/PageTop";

type TournamentPublic = {
  tournament: {
    id: string;
    title: string;
    officialThreshold: number;
    maxTeams: number;
    announcement?: string | null;
  } | null;
  claimedTeams: number;
  confirmedTeams: number;
  official: boolean;
  full: boolean;
  error?: string;
};

function headline(d: TournamentPublic | null) {
  if (!d?.tournament) return "No live tournament";
  if (d.full) return "Tournament full";
  if (d.official) return "Tournament confirmed";
  return "Organizing";
}

export default function TournamentStatusPage() {
  const [data, setData] = useState<TournamentPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/tournament/public", { cache: "no-store" });
        const j = (await r.json()) as TournamentPublic & { error?: string };
        if (!r.ok) {
          if (!cancelled) {
            setErr(j?.error || "Could not load status.");
            setData(null);
          }
          return;
        }
        if (!cancelled) {
          setData(j);
          setErr(null);
        }
      } catch {
        if (!cancelled) {
          setErr("Could not load status.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const t = data?.tournament ?? null;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 pt-2">
        <PageTop flush title="STATUS" fallbackHref="/tournament" />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-10">
        <section className="rounded-card border border-line bg-overlay-subtle p-8">
          <div className="text-small font-semibold text-ink">
            Tournament Status
          </div>

          {loading ? (
            <div className="mt-4 text-small text-muted">Loading…</div>
          ) : err ? (
            <div className="mt-4 text-small text-muted">{err}</div>
          ) : !t ? (
            <>
              <div className="mt-4 text-h3 font-serif font-semibold text-ink">{headline(data)}</div>
              <EmptyStateMessage className="mt-2">
                No tournaments available
              </EmptyStateMessage>
            </>
          ) : (
            <>
              <div className="mt-4 text-h3 font-serif font-semibold text-ink">{headline(data)}</div>
              <div className="mt-2 text-small text-muted">
                {t.title ? `${t.title}. ` : null}
                Confirmed teams: {data?.confirmedTeams ?? 0} of {t.maxTeams} max. Teams working through signup:{"  "}
                {data?.claimedTeams ?? 0}. Goes official at {t.officialThreshold} confirmed teams.
              </div>
              {t.announcement ? (
                <div className="mt-5 rounded-card border border-line bg-overlay-subtle px-4 py-3 text-small text-ink whitespace-pre-wrap">
                  {t.announcement}
                </div>
              ) : null}
              <div className="mt-6">
                <Link
                  href="/tournament"
                  className="text-small text-muted underline underline-offset-4 hover:text-ink"
                >
                  Tournament hub
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
