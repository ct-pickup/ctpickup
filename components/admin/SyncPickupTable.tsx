"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { StatusChip } from "@/components/admin/StatusChip";
import { OperatorActionResult } from "@/components/admin/OperatorActionResult";
import type { PickupSyncSummary } from "@/lib/admin/pickupSyncSummaries";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";

function fmt(dt: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "—";
  }
}

export function SyncPickupTable({ summaries }: { summaries: PickupSyncSummary[] }) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, unknown> | null>(null);

  const runProcessor = useCallback(
    async (runId: string) => {
      setRowResult(null);
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      setBusyId(runId);
      try {
        const r = await fetch("/api/admin/operator", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_pickup_run", run_id: runId }),
        });
        const j = await r.json().catch(() => ({}));
        setRowResult(j);
        router.refresh();
      } finally {
        setBusyId(null);
      }
    },
    [supabase, router]
  );

  if (!isReady) {
    return <p className="text-sm text-white/50">Loading sync actions…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/45">
        Run processor does the same timed checks as when you open a run in Pickups. If nothing is due yet, you’ll see a
        no-op message — that’s normal.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-white/50">
            <tr className="border-b border-white/10">
              <th className="p-3">Run</th>
              <th className="p-3">Status</th>
              <th className="p-3">Auto</th>
              <th className="p-3">Last automation change</th>
              <th className="p-3">Reminder times</th>
              <th className="p-3">Next step</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const pending =
                s.auto_managed &&
                (s.next_step.startsWith("Due:") ||
                  s.next_step.includes("checkpoint") ||
                  s.next_step.includes("Add at least one time slot"));
              return (
                <tr key={s.id} className="border-b border-white/10 align-top">
                  <td className="p-3 font-medium text-white">{s.title}</td>
                  <td className="p-3 text-white/70" title={s.status}>
                    {labelPickupRunStatus(s.status)}
                  </td>
                  <td className="p-3">
                    {s.auto_managed ? (
                      <StatusChip tone="published">On</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Off</StatusChip>
                    )}
                  </td>
                  <td className="p-3 text-xs text-white/55 whitespace-nowrap">{fmt(s.updated_at)}</td>
                  <td className="p-3 text-xs text-white/55 font-mono whitespace-nowrap">
                    {fmt(s.checkpoints.cp_24h_at)} · {fmt(s.checkpoints.cp_12h_at)}
                    <br />
                    {fmt(s.checkpoints.cp_6h_at)} · {fmt(s.checkpoints.cp_1h_at)}
                  </td>
                  <td className="p-3 text-white/70">
                    <div className="flex flex-wrap items-center gap-2">
                      {pending ? <StatusChip tone="pending">Pending</StatusChip> : <StatusChip tone="synced">OK</StatusChip>}
                    </div>
                    <div className="mt-1 text-xs">{s.next_step}</div>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={busyId !== null || !s.auto_managed}
                      title={!s.auto_managed ? "Launch outreach from Pickups to enable auto pipeline." : undefined}
                      onClick={() => void runProcessor(s.id)}
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40"
                    >
                      {busyId === s.id ? "Running…" : "Run processor"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {summaries.length === 0 ? (
              <tr>
                <td className="p-6 text-white/50" colSpan={7}>
                  No pickup runs found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {rowResult ? (
        <OperatorActionResult
          ok={!!rowResult.ok}
          error={typeof rowResult.error === "string" ? rowResult.error : null}
          hint={typeof rowResult.hint === "string" ? rowResult.hint : null}
          blocked={!!rowResult.blocked}
          skipped={!!rowResult.skipped}
          effects={rowResult.effects as { record: string; detail: string }[] | undefined}
          verify={rowResult.verify as { label: string; href: string }[] | undefined}
          messages={rowResult.messages as string[] | undefined}
        />
      ) : null}
    </div>
  );
}
