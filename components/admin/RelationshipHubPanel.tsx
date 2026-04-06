"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { OperatorActionResult } from "@/components/admin/OperatorActionResult";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";

export type HubPickupOption = { id: string; title: string | null; status: string };
export type HubTournamentOption = { id: string; title: string | null };

export function RelationshipHubPanel({
  pickupRuns,
  tournaments,
  currentPickupId,
  activeTournamentId,
}: {
  pickupRuns: HubPickupOption[];
  tournaments: HubTournamentOption[];
  currentPickupId: string | null;
  activeTournamentId: string | null;
}) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [pickupChoice, setPickupChoice] = useState(currentPickupId || "");
  const [tourneyChoice, setTourneyChoice] = useState(activeTournamentId || "");
  const [confirmPickup, setConfirmPickup] = useState(false);
  const [confirmTourney, setConfirmTourney] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickupResult, setPickupResult] = useState<Record<string, unknown> | null>(null);
  const [tourneyResult, setTourneyResult] = useState<Record<string, unknown> | null>(null);

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
      return r.json().then((j) => ({ ok: r.ok, j }));
    },
    [supabase]
  );

  async function applyPickup(run_id: string | null) {
    setPickupResult(null);
    setBusy(true);
    try {
      const { ok, j } = await callOperator({ action: "set_hub_pickup", run_id });
      if (!ok) {
        setPickupResult({ ok: false, error: typeof j?.error === "string" ? j.error : "Failed" });
      } else {
        setPickupResult(j);
        setConfirmPickup(false);
      }
    } catch (e) {
      setPickupResult({ ok: false, error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  async function applyTournament(tournament_id: string | null) {
    setTourneyResult(null);
    setBusy(true);
    try {
      const { ok, j } = await callOperator({ action: "set_hub_tournament", tournament_id });
      if (!ok) {
        setTourneyResult({ ok: false, error: typeof j?.error === "string" ? j.error : "Failed" });
      } else {
        setTourneyResult(j);
        setConfirmTourney(false);
        router.refresh();
      }
    } catch (e) {
      setTourneyResult({ ok: false, error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!isReady) return <p className="text-sm text-white/50">Loading hub controls…</p>;

  return (
    <div className="mt-8 space-y-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Fix hub links here</h3>
        <p className="mt-1 text-xs text-white/50">
          Confirm once — this is the same as promoting a pickup run or choosing a live tournament elsewhere.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">Pickup hub</h4>
          <p className="text-xs text-white/55">
            <span className="text-white/75">Players see this on:</span> pickup hub, RSVPs, and the pickup status page when the
            run is public.
          </p>
          <select
            value={pickupChoice}
            onChange={(e) => setPickupChoice(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">— No run on the hub —</option>
            {pickupRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || r.id} · {labelPickupRunStatus(r.status)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-white/65">
            <input type="checkbox" checked={confirmPickup} onChange={(e) => setConfirmPickup(e.target.checked)} />
            I understand this chooses which run the pickup hub shows.
          </label>
          <button
            type="button"
            disabled={busy || !confirmPickup}
            onClick={() => void applyPickup(pickupChoice || null)}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            Apply pickup hub
          </button>
          {pickupResult ? (
            <OperatorActionResult
              ok={!!pickupResult.ok}
              error={typeof pickupResult.error === "string" ? pickupResult.error : null}
              effects={pickupResult.effects as { record: string; detail: string }[] | undefined}
              verify={pickupResult.verify as { label: string; href: string }[] | undefined}
            />
          ) : null}
        </section>

        <section className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">Tournament hub</h4>
          <p className="text-xs text-white/55">
            <span className="text-white/75">Players see this on:</span> tournament hub and tournament status page.
          </p>
          <select
            value={tourneyChoice}
            onChange={(e) => setTourneyChoice(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">— No live tournament —</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || t.id}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-white/65">
            <input type="checkbox" checked={confirmTourney} onChange={(e) => setConfirmTourney(e.target.checked)} />
            I understand only one tournament can be live — others are taken offline first.
          </label>
          <button
            type="button"
            disabled={busy || !confirmTourney}
            onClick={() => void applyTournament(tourneyChoice || null)}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            Apply tournament hub
          </button>
          {tourneyResult ? (
            <OperatorActionResult
              ok={!!tourneyResult.ok}
              error={typeof tourneyResult.error === "string" ? tourneyResult.error : null}
              effects={tourneyResult.effects as { record: string; detail: string }[] | undefined}
              verify={tourneyResult.verify as { label: string; href: string }[] | undefined}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
