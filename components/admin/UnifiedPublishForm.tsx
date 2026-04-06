"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { OperatorActionResult } from "@/components/admin/OperatorActionResult";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";

export type PublishRunOption = { id: string; title: string | null; status: string; is_current: boolean };

export function UnifiedPublishForm({
  pickupRuns,
  defaultRunId,
  className = "",
}: {
  pickupRuns: PublishRunOption[];
  /** Pre-select promoted run for run-scoped channel when present */
  defaultRunId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [message, setMessage] = useState("");
  const [statusRow, setStatusRow] = useState(false);
  const [pickupGlobal, setPickupGlobal] = useState(true);
  const [pickupRun, setPickupRun] = useState(false);
  const [tournamentMsg, setTournamentMsg] = useState(false);
  const [runId, setRunId] = useState(() => {
    const promoted = pickupRuns.find((r) => r.is_current);
    if (defaultRunId && pickupRuns.some((r) => r.id === defaultRunId)) return defaultRunId;
    return promoted?.id ?? pickupRuns[0]?.id ?? "";
  });
  const [busy, setBusy] = useState(false);
  const [lastJson, setLastJson] = useState<Record<string, unknown> | null>(null);

  const previewLines = useMemo(() => {
    const lines: string[] = [];
    if (statusRow) {
      lines.push("Replaces the main site-wide announcement (help chat and staff tools use it).");
    }
    if (pickupGlobal) {
      lines.push("Adds a pickup post for all players — shows on pickup status and feeds.");
    }
    if (pickupRun && runId) {
      lines.push(`Adds a pickup post for one run (${runId.slice(0, 8)}…).`);
    }
    if (tournamentMsg) {
      lines.push("Saves the announcement on whichever tournament is live for players.");
    }
    if (lines.length === 0) {
      lines.push("Select at least one destination below.");
    }
    return lines;
  }, [statusRow, pickupGlobal, pickupRun, runId, tournamentMsg]);

  const blocked = useMemo(() => {
    const reasons: string[] = [];
    if (pickupRun && !runId) reasons.push("Pick a pickup run for the run-scoped post.");
    return reasons;
  }, [pickupRun, runId]);

  const callOperator = useCallback(
    async (body: Record<string, unknown>) => {
      if (!supabase) throw new Error("Not signed in.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const r = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(typeof j?.error === "string" ? j.error : "Request failed");
        (err as Error & { payload?: unknown }).payload = j;
        throw err;
      }
      return j;
    },
    [supabase]
  );

  async function onPublish() {
    setLastJson(null);
    if (!isReady) return;
    if (!message.trim()) return;
    if (blocked.length) return;
    setBusy(true);
    try {
      const j = await callOperator({
        action: "publish",
        message: message.trim(),
        targets: {
          status_updates: statusRow,
          pickup_global: pickupGlobal,
          pickup_run_id: pickupRun && runId ? runId : null,
          tournament_active: tournamentMsg,
        },
      });
      setLastJson(j);
      setMessage("");
      router.refresh();
    } catch (e) {
      const err = e as Error & { payload?: { error?: string; hint?: string } };
      setLastJson({
        ok: false,
        error: err.message,
        hint: err.payload?.hint ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!isReady) {
    return <p className="text-sm text-white/50">Loading publish tools…</p>;
  }

  return (
    <div className={`rounded-2xl border border-white/15 bg-white/[0.05] p-5 space-y-4 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-white">Publish an update (one composer)</h3>
        <p className="mt-1 text-xs text-white/50">
          One message can go everywhere you select — same outcomes as the older editors, without duplicating work.
        </p>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        placeholder="Write the announcement once…"
        className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={pickupGlobal}
            onChange={(e) => setPickupGlobal(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-white">Pickup · all players</span>
            <span className="block text-xs text-white/45">Everyone following pickup sees this.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={pickupRun}
            onChange={(e) => setPickupRun(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-white">Pickup · one run</span>
            <span className="block text-xs text-white/45">Only people on that run’s thread.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={statusRow}
            onChange={(e) => setStatusRow(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-white">Site-wide status</span>
            <span className="block text-xs text-white/45">Help chat and internal status tools.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={tournamentMsg}
            onChange={(e) => setTournamentMsg(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-white">Live tournament</span>
            <span className="block text-xs text-white/45">Shown on the public tournament hub and status page.</span>
          </span>
        </label>
      </div>

      {pickupRun ? (
        <div>
          <div className="text-xs uppercase tracking-wider text-white/45 mb-1">Pickup run</div>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="w-full max-w-md rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">Select run…</option>
            {pickupRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || r.id} · {labelPickupRunStatus(r.status)}
                {r.is_current ? " · on hub" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-black/40 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Before you publish</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/65">
          {previewLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {blocked.length > 0 ? (
          <p className="mt-2 text-xs text-amber-200/90">{blocked.join(" ")}</p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy || !message.trim() || blocked.length > 0}
        onClick={() => void onPublish()}
        className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-45 hover:opacity-95"
      >
        {busy ? "Publishing…" : "Publish now"}
      </button>

      {lastJson ? (
        <OperatorActionResult
          ok={!!lastJson.ok}
          error={typeof lastJson.error === "string" ? lastJson.error : null}
          hint={typeof lastJson.hint === "string" ? lastJson.hint : null}
          blocked={!!lastJson.blocked}
          skipped={!!lastJson.skipped}
          effects={Array.isArray(lastJson.effects) ? (lastJson.effects as { record: string; detail: string }[]) : undefined}
          verify={Array.isArray(lastJson.verify) ? (lastJson.verify as { label: string; href: string }[]) : undefined}
          messages={Array.isArray(lastJson.messages) ? (lastJson.messages as string[]) : undefined}
        />
      ) : null}
    </div>
  );
}
