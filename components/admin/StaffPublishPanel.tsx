"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperatorActionResult } from "@/components/admin/OperatorActionResult";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";
import type { PublishTargetsInput } from "@/lib/admin/publish/types";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

export type StaffPublishRunOption = {
  id: string;
  title: string | null;
  status: string;
  is_current: boolean;
};

type Destination = "site" | "pickup" | "both";

function buildTargets(args: {
  destination: Destination;
  runId: string;
  advancedAllPickup: boolean;
  advancedTournament: boolean;
  hasActiveTournament: boolean;
}): PublishTargetsInput {
  const { destination, runId, advancedAllPickup, advancedTournament, hasActiveTournament } = args;
  const siteStatus = destination === "site" || destination === "both";
  const pickupRunIds =
    destination === "pickup" || destination === "both"
      ? runId.trim()
        ? [runId.trim()]
        : []
      : [];
  return {
    siteStatus,
    pickupGlobal: advancedAllPickup,
    pickupRunIds,
    tournamentActive: hasActiveTournament && advancedTournament,
  };
}

export function StaffPublishPanel({
  pickupRuns,
  defaultRunId,
  hasActiveTournament,
  publishLayerOk,
  className = "",
}: {
  pickupRuns: StaffPublishRunOption[];
  defaultRunId?: string | null;
  hasActiveTournament: boolean;
  /** When false, uses `/api/admin/operator` (no publication log / idempotency table). */
  publishLayerOk: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [destination, setDestination] = useState<Destination>("both");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [runId, setRunId] = useState(() => {
    if (defaultRunId && pickupRuns.some((r) => r.id === defaultRunId)) return defaultRunId;
    const promoted = pickupRuns.find((r) => r.is_current);
    return promoted?.id ?? pickupRuns[0]?.id ?? "";
  });
  const [advancedAllPickup, setAdvancedAllPickup] = useState(false);
  const [advancedTournament, setAdvancedTournament] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null);
  const idemRef = useRef<string | null>(null);

  useEffect(() => {
    if (defaultRunId && pickupRuns.some((r) => r.id === defaultRunId)) {
      setRunId(defaultRunId);
    }
  }, [defaultRunId, pickupRuns]);

  const targets = useMemo(
    () =>
      buildTargets({
        destination,
        runId,
        advancedAllPickup,
        advancedTournament,
        hasActiveTournament,
      }),
    [destination, runId, advancedAllPickup, advancedTournament, hasActiveTournament],
  );

  const blockedReasons = useMemo(() => {
    const reasons: string[] = [];
    const hasPickupChannel =
      !!runId.trim() ||
      advancedAllPickup ||
      (advancedTournament && hasActiveTournament);

    if (destination === "pickup" || destination === "both") {
      if (!hasPickupChannel) {
        reasons.push("Choose a pickup run or enable an option under “More destinations”.");
      }
      if (pickupRuns.length === 0 && !runId.trim() && !advancedAllPickup && !advancedTournament) {
        reasons.push("No pickup runs yet — create one under Pickups first.");
      }
    }
    return reasons;
  }, [
    destination,
    runId,
    advancedAllPickup,
    advancedTournament,
    hasActiveTournament,
    pickupRuns.length,
  ]);

  const authHeader = useCallback(async () => {
    if (!supabase) return null;
    const s = await supabase.auth.getSession();
    return s.data.session?.access_token ?? null;
  }, [supabase]);

  async function onPublish() {
    setFeedback(null);
    if (!isReady || blockedReasons.length) return;
    const token = await authHeader();
    if (!token) {
      setFeedback({ ok: false, error: "Sign in to publish." });
      return;
    }

    if (publishLayerOk) {
      if (!idemRef.current) {
        idemRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `pub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
    }

    setBusy(true);
    try {
      if (publishLayerOk) {
        const r = await fetch("/api/admin/publish", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            label: label.trim() || null,
            targets,
            idempotency_key: idemRef.current,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & {
          duplicate?: boolean;
          deliveries?: { sync_state?: string }[];
          revalidateError?: string | null;
          effects?: { record: string; detail: string }[];
          verify?: { label: string; href: string }[];
        };
        if (!r.ok) {
          setFeedback({
            ok: false,
            error: typeof j?.error === "string" ? j.error : "Publish failed.",
          });
          return;
        }
        idemRef.current = null;
        const dup = j.duplicate === true;
        const failed = Array.isArray(j.deliveries)
          ? j.deliveries.filter((d) => d.sync_state === "failed").length
          : 0;
        const messages: string[] = [];
        if (dup) messages.push("Already applied — nothing new was written.");
        else if (failed) messages.push(`${failed} destination(s) failed. Open Sync & status to retry.`);
        else messages.push("Published. Public pages pick this up on the next load (cache was refreshed).");
        if (j.revalidateError) messages.push(`Refresh job note: ${j.revalidateError}`);
        setFeedback({
          ok: failed === 0,
          messages,
          effects: Array.isArray(j.effects) ? j.effects : undefined,
          verify: Array.isArray(j.verify) ? j.verify : undefined,
        });
        setMessage("");
        router.refresh();
        return;
      }

      const r = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          message,
          label: label.trim() || null,
          targets: {
            status_updates: targets.siteStatus,
            pickup_global: targets.pickupGlobal,
            pickup_run_id: targets.pickupRunIds?.[0] ?? null,
            tournament_active: targets.tournamentActive,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFeedback({
          ok: false,
          error: typeof j?.error === "string" ? j.error : "Publish failed.",
          hint: typeof j?.hint === "string" ? j.hint : null,
        });
        return;
      }
      setFeedback(j as Record<string, unknown>);
      setMessage("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!isReady) {
    return <p className="text-sm text-white/50">Loading…</p>;
  }

  return (
    <div className={`rounded-2xl border border-white/12 bg-white/[0.04] p-5 space-y-5 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-white">Publish</h3>
        <p className="mt-1 text-xs text-white/50">
          One submission can update the site-wide announcement and/or add a pickup post for a run. Optional title becomes
          the first line of the stored message everywhere it is written.
        </p>
      </div>

      <label className="block space-y-2">
        <span className="text-xs font-medium uppercase tracking-wider text-white/45">Where it goes</span>
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value as Destination)}
          className="w-full max-w-md rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none"
        >
          <option value="site">Site-wide announcement only</option>
          <option value="pickup">Pickup run only</option>
          <option value="both">Site-wide + pickup run</option>
        </select>
      </label>

      {(destination === "pickup" || destination === "both") && pickupRuns.length > 0 ? (
        <label className="block space-y-2">
          <span className="text-xs font-medium uppercase tracking-wider text-white/45">Pickup run</span>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="w-full max-w-md rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none"
          >
            <option value="">Select run…</option>
            {pickupRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || r.id} · {labelPickupRunStatus(r.status)}
                {r.is_current ? " · on hub" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-2">
        <span className="text-xs font-medium uppercase tracking-wider text-white/45">Title (optional)</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Short headline — optional"
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-xs font-medium uppercase tracking-wider text-white/45">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="What players and staff should know…"
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-white/35"
        />
      </label>

      <details className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
        <summary className="cursor-pointer select-none text-white/80">More destinations</summary>
        <div className="mt-3 space-y-3 pb-1">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={advancedAllPickup}
              onChange={(e) => setAdvancedAllPickup(e.target.checked)}
            />
            <span>
              <span className="font-medium text-white">All pickup players</span>
              <span className="block text-xs text-white/45">
                Adds a global pickup post (not tied to one run). Shown on pickup status and feeds.
              </span>
            </span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 ${!hasActiveTournament ? "opacity-45" : ""}`}>
            <input
              type="checkbox"
              className="mt-1"
              disabled={!hasActiveTournament}
              checked={advancedTournament && hasActiveTournament}
              onChange={(e) => setAdvancedTournament(e.target.checked)}
            />
            <span>
              <span className="font-medium text-white">Live tournament hub</span>
              <span className="block text-xs text-white/45">
                {hasActiveTournament
                  ? "Uses the tournament that is marked live in admin."
                  : "No live tournament — set one in Tournaments first."}
              </span>
            </span>
          </label>
        </div>
      </details>

      {blockedReasons.length > 0 ? (
        <p className="text-xs text-amber-200/90">{blockedReasons.join(" ")}</p>
      ) : null}

      <button
        type="button"
        disabled={busy || !message.trim() || blockedReasons.length > 0}
        onClick={() => void onPublish()}
        className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:opacity-95 disabled:opacity-40"
      >
        {busy ? "Publishing…" : "Publish"}
      </button>

      {!publishLayerOk ? (
        <p className="text-xs text-amber-200/85">
          Full publish logging isn’t enabled in the database — publishes still apply, but you won’t get idempotent retries or
          per-destination history until migrations are applied.
        </p>
      ) : null}

      {feedback ? (
        <OperatorActionResult
          ok={!!feedback.ok}
          error={typeof feedback.error === "string" ? feedback.error : null}
          hint={typeof feedback.hint === "string" ? feedback.hint : null}
          blocked={!!feedback.blocked}
          skipped={!!feedback.skipped}
          effects={Array.isArray(feedback.effects) ? (feedback.effects as { record: string; detail: string }[]) : undefined}
          verify={Array.isArray(feedback.verify) ? (feedback.verify as { label: string; href: string }[]) : undefined}
          messages={Array.isArray(feedback.messages) ? (feedback.messages as string[]) : undefined}
        />
      ) : null}
    </div>
  );
}
