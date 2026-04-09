"use client";

import Link from "next/link";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import { Panel } from "@/components/layout";
import {
  PickupStatCell,
  PickupSubpageLoading,
  PickupSubpageShell,
} from "@/components/pickup";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type UpcomingRun = {
  id: string;
  title: string | null;
  start_at: string;
  level_label: string;
  spots_left: number;
};

type PublicPayload = {
  status?: string;
  run: {
    id: string;
    title?: string | null;
    start_at?: string | null;
    run_type?: string | null;
    capacity?: number | null;
    location_text?: string | null;
  } | null;
  counts?: { confirmed?: number };
  my_status?: string | null;
};

function fmtRunDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function fmtRunTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function levelLabel(runType: string | null | undefined) {
  if (runType === "public") return "Open signup";
  if (runType === "select") return "Invite based";
  return "—";
}

function myStatusLabel(myStatus: string | null | undefined) {
  if (!myStatus) return "Not joined yet";
  return myStatus.replace(/_/g, " ");
}

function SelectedRunJoin({ runId }: { runId: string }) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [data, setData] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    (async () => {
      try {
        let token: string | undefined;
        if (supabase) {
          const session = await supabase.auth.getSession();
          token = session.data.session?.access_token;
        }
        const qs = `?run_id=${encodeURIComponent(runId)}`;
        const headers: HeadersInit = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await fetch(`/api/pickup/public${qs}`, { headers, cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Could not load run.");
        if (!cancelled) {
          setData(j as PublicPayload);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load run.");
          setData({ run: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, isReady, runId]);

  const loading = data === null;
  const run = data?.run ?? null;
  const capacity = run?.capacity ?? 0;
  const confirmed = data?.counts?.confirmed ?? 0;
  const spotsLeft = Math.max(0, Number(capacity) - Number(confirmed));

  if (loading) {
    return <p className="text-sm text-white/60">Loading run…</p>;
  }
  if (error) {
    return <p className="text-sm text-white/60">{error}</p>;
  }
  if (!run) {
    return (
      <Panel className="space-y-2">
        <EmptyStateMessage>This run isn’t available to join</EmptyStateMessage>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Join this run</p>
      <Panel className="space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Selected run</p>
          <h2 className="text-2xl font-bold uppercase tracking-tight text-white md:text-3xl">
            {run.title || "Pickup run"}
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PickupStatCell label="Date" value={fmtRunDate(run.start_at)} />
          <PickupStatCell label="Time" value={fmtRunTime(run.start_at)} />
          <PickupStatCell label="Level" value={levelLabel(run.run_type)} />
          <PickupStatCell label="Spots left" value={spotsLeft} />
          <div className="sm:col-span-2 lg:col-span-3">
            <PickupStatCell label="Location" value={run.location_text ?? "Hidden until confirmed"} />
          </div>
        </div>
      </Panel>

      <Panel className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Your status</p>
        <p className="text-lg font-semibold text-white">{myStatusLabel(data?.my_status)}</p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/pickup/intake"
            className="inline-flex min-w-[200px] items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            Continue
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function UpcomingGamesContent() {
  const searchParams = useSearchParams();
  const selectedRunId = searchParams.get("run");

  const [runs, setRuns] = useState<UpcomingRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/pickup/upcoming-list", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Could not load runs.");
        if (!cancelled) setRuns(Array.isArray(j?.runs) ? j.runs : []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load runs.");
          setRuns([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = runs === null;

  return (
    <PickupSubpageShell
      maxWidthClass="max-w-4xl"
      title="Upcoming Games"
      intro="Browse upcoming runs and reserve a spot."
    >
      <div className="space-y-8">
        {selectedRunId ? <SelectedRunJoin runId={selectedRunId} /> : null}

        <div className="space-y-4">
          {selectedRunId ? (
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">All upcoming</p>
          ) : null}

          {loading ? (
            <p className="text-sm text-white/60">Loading…</p>
          ) : error ? (
            <p className="text-sm text-white/60">{error}</p>
          ) : runs.length === 0 ? (
            <Panel className="space-y-2">
              <EmptyStateMessage>No active pickup games</EmptyStateMessage>
            </Panel>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <Panel key={run.id} className="space-y-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                    {run.title || "Pickup run"}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <PickupStatCell label="Date" value={fmtRunDate(run.start_at)} />
                    <PickupStatCell label="Time" value={fmtRunTime(run.start_at)} />
                    <PickupStatCell label="Level" value={run.level_label} />
                    <PickupStatCell label="Spots left" value={run.spots_left} />
                    <div className="sm:col-span-2 lg:col-span-3">
                      <PickupStatCell label="Location" value="Hidden until confirmed" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/pickup/upcoming-games?run=${encodeURIComponent(run.id)}`}
                      className="inline-flex min-w-[160px] items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black"
                    >
                      Join
                    </Link>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      </div>
    </PickupSubpageShell>
  );
}

export default function UpcomingGamesPage() {
  return (
    <Suspense fallback={<PickupSubpageLoading title="Upcoming Games" />}>
      <UpcomingGamesContent />
    </Suspense>
  );
}
