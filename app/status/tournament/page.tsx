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
    <main className="min-h-screen bg-[#0f0f10] text-white">
      <div className="mx-auto max-w-6xl px-6 pt-2">
        <PageTop flush title="STATUS" fallbackHref="/tournament" />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-10">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
            Tournament Status
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-white/60">Loading…</div>
          ) : err ? (
            <div className="mt-4 text-sm text-white/70">{err}</div>
          ) : !t ? (
            <>
              <div className="mt-4 text-lg font-semibold text-white/90">{headline(data)}</div>
              <EmptyStateMessage className="mt-2">
                No tournaments available
              </EmptyStateMessage>
            </>
          ) : (
            <>
              <div className="mt-4 text-lg font-semibold text-white/90">{headline(data)}</div>
              <div className="mt-2 text-sm text-white/60">
                {t.title ? `${t.title}. ` : null}
                Confirmed teams: {data?.confirmedTeams ?? 0} of {t.maxTeams} max. Teams working through signup:{" "}
                {data?.claimedTeams ?? 0}. Goes official at {t.officialThreshold} confirmed teams.
              </div>
              {t.announcement ? (
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/85 whitespace-pre-wrap">
                  {t.announcement}
                </div>
              ) : null}
              <div className="mt-6">
                <Link
                  href="/tournament"
                  className="text-sm text-white/75 underline underline-offset-4 hover:text-white"
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
