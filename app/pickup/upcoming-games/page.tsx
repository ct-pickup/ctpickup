"use client";

import Link from "next/link";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import { Panel } from "@/components/layout";
import { PickupStatCell, PickupSubpageShell } from "@/components/pickup";
import { useEffect, useState } from "react";

type UpcomingRun = {
  id: string;
  title: string | null;
  start_at: string;
  level_label: string;
  spots_left: number;
};

function fmtRunDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function fmtRunTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default function UpcomingGamesPage() {
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
      intro="Upcoming runs across locations."
    >
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
                  <PickupStatCell
                    label="Location"
                    value="Hidden until confirmed"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/pickup/join-a-game?run=${encodeURIComponent(run.id)}`}
                  className="inline-flex min-w-[160px] items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black"
                >
                  Join
                </Link>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PickupSubpageShell>
  );
}
