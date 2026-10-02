"use client";

import Link from "next/link";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import { Panel } from "@/components/layout";
import {
  PickupStatCell,
  PickupSubpageLoading,
  PickupSubpageShell,
} from "@/components/pickup";
import { fmtPickupTimeEt, runTimeTbd } from "@/lib/pickup/runStartAtDisplay";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type UpcomingRun = {
  id: string;
  title: string | null;
  start_at: string;
  time_tbd?: boolean;
  level_label: string;
  spots_left: number;
};

type PublicPayload = {
  status?: string;
  run: {
    id: string;
    title?: string | null;
    start_at?: string | null;
    time_tbd?: boolean;
    run_type?: string | null;
    capacity?: number | null;
    location_text?: string | null;
  } | null;
  counts?: { confirmed?: number };
  my_status?: string | null;
};

function fmtRunDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
}

function fmtRunTime(iso: string | null | undefined, timeTbd = false) {
  if (!iso) return "—";
  return timeTbd ? "Time TBD" : `${fmtPickupTimeEt(iso)} ET`;
}

function levelLabel(runType: string | null | undefined) {
  if (runType === "public") return "Open signup";
  if (runType === "select") return "Invite based";
  return "—";
}

function myStatusLabel(myStatus: string | null | undefined) {
  if (!myStatus) return "Not joined yet";
  return myStatus.replace(/_/g, "  ");
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
    return <p className="text-small text-muted">Loading run…</p>;
  }
  if (error) {
    return <p className="text-small text-muted">{error}</p>;
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
      <p className="text-caption font-semibold text-muted">Join this run</p>
      <Panel className="space-y-5">
        <div className="space-y-1">
          <p className="text-caption font-semibold text-muted">Selected run</p>
          <h2 className="text-h2 font-serif font-bold text-ink">
            {run.title || "Pickup run"}
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PickupStatCell label="Date" value={fmtRunDate(run.start_at)} />
          <PickupStatCell label="Time" value={fmtRunTime(run.start_at, runTimeTbd(run))} />
          <PickupStatCell label="Level" value={levelLabel(run.run_type)} />
          <PickupStatCell label="Spots left" value={spotsLeft} />
          <div className="sm:col-span-2 lg:col-span-3">
            <PickupStatCell label="Location" value={run.location_text ?? "Hidden until confirmed"} />
          </div>
        </div>
      </Panel>

      <Panel className="space-y-4">
        <p className="text-caption font-semibold text-muted">Your status</p>
        <p className="text-h3 font-serif font-semibold text-ink">{myStatusLabel(data?.my_status)}</p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/pickup/intake"
            className="inline-flex min-w-[200px] items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch"
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
            <p className="text-caption font-semibold text-muted">All upcoming</p>
          ) : null}

          {loading ? (
            <p className="text-small text-muted">Loading…</p>
          ) : error ? (
            <p className="text-small text-muted">{error}</p>
          ) : runs.length === 0 ? (
            <Panel className="space-y-2">
              <EmptyStateMessage>No active pickup games</EmptyStateMessage>
            </Panel>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <Panel key={run.id} className="space-y-5">
                  <p className="text-caption font-semibold text-muted">
                    {run.title || "Pickup run"}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <PickupStatCell label="Date" value={fmtRunDate(run.start_at)} />
                    <PickupStatCell label="Time" value={fmtRunTime(run.start_at, runTimeTbd(run))} />
                    <PickupStatCell label="Level" value={run.level_label} />
                    <PickupStatCell label="Spots left" value={run.spots_left} />
                    <div className="sm:col-span-2 lg:col-span-3">
                      <PickupStatCell label="Location" value="Hidden until confirmed" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/pickup/upcoming-games?run=${encodeURIComponent(run.id)}`}
                      className="inline-flex min-w-[160px] items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch"
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
