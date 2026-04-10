"use client";

import Link from "next/link";
import PageTop from "@/components/PageTop";
import {
  OperatorLatestLine,
  OperatorLiveBar,
  OperatorNextSteps,
  OperatorQuickActions,
  OperatorWhereAppears,
} from "@/components/admin/operator/OperatorSections";
import { PromotePickupRunButton } from "@/components/admin/PromotePickupRunButton";
import type { PickupOperatorBundle } from "@/lib/admin/operatorContext";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useCallback, useEffect, useMemo, useState } from "react";

function fmt(dt: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "—";
  }
}

const LOCATION_PRESETS = {
  new_haven: `New Haven SoccerRoof
1018 Sherman Ave, Hamden, CT 06514

Parking
Parking lot directly outside the building on Sherman Ave (in front of the facility entrance).

Field Number
Leave blank.`,
  new_rochelle: `New Rochelle SoccerRoof
29 LeCount Pl, 3rd Floor, New Rochelle, NY 10801

Parking
New Roc City Garage - parking garage attached to the New Roc City complex next to the facility.

Field Number
Leave blank.`,
} as const;

function pickupNextSteps(
  selectedRun: Record<string, unknown> | null,
  detail: { slots?: unknown[] } | null,
  launchBlockedReason: string | null,
): string[] {
  const out: string[] = [];
  if (!selectedRun) return out;
  if (String(selectedRun.status) === "canceled") return ["Run is canceled."];
  const slots = detail?.slots?.length ?? 0;
  if (!slots) out.push("Add a kickoff slot.");
  if (!selectedRun.outreach_started_at) {
    if (launchBlockedReason) out.push(launchBlockedReason);
    else if (slots) out.push("Launch outreach (36h+ before kickoff).");
  }
  if (!selectedRun.final_slot_id && String(selectedRun.status) !== "active") {
    out.push("Finalize a slot for RSVP.");
  }
  return out;
}

export default function PickupOperatorClient() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [detail, setDetail] = useState<any | null>(null);
  const [opCtx, setOpCtx] = useState<PickupOperatorBundle | null>(null);
  const [opCtxErr, setOpCtxErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wave1Result, setWave1Result] = useState<{
    invited: number;
    handles: string[];
    dm_template: string;
  } | null>(null);

  const [title, setTitle] = useState("CT Pickup Run");
  const [runType, setRunType] = useState<"select" | "public">("select");
  const [capacity, setCapacity] = useState(18);
  const [feeCents, setFeeCents] = useState(0);
  const [locationPrivate, setLocationPrivate] = useState("");
  const [locConfirmedOnly, setLocConfirmedOnly] = useState(true);
  const [locationPreset, setLocationPreset] = useState<"" | "new_haven" | "new_rochelle" | "other">("");
  const [slotStart, setSlotStart] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [finalSlotId, setFinalSlotId] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setMsg(null);
    const r = await fetch("/api/pickup/switch", { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j?.error || "Could not load runs.");
      setRuns([]);
      return;
    }
    setRuns(j?.runs || []);
  }, [token]);

  const loadDetail = useCallback(
    async (runId: string) => {
      if (!token || !runId) return;
      setMsg(null);
      const r = await fetch(`/api/pickup/switch?run_id=${encodeURIComponent(runId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      setDetail(j);
      setFinalSlotId("");
    },
    [token],
  );

  const loadOperatorCtx = useCallback(async () => {
    if (!token || !selectedRunId) {
      setOpCtx(null);
      setOpCtxErr(false);
      return;
    }
    const r = await fetch(`/api/admin/operator/pickup-context?run_id=${encodeURIComponent(selectedRunId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => null);
    if (r.ok && j) {
      setOpCtx(j as PickupOperatorBundle);
      setOpCtxErr(false);
    } else {
      setOpCtx(null);
      setOpCtxErr(true);
    }
  }, [token, selectedRunId]);

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const s = await supabase.auth.getSession();
      setToken(s.data.session?.access_token || null);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  useEffect(() => {
    if (selectedRunId) void loadDetail(selectedRunId);
  }, [selectedRunId, loadDetail]);

  useEffect(() => {
    void loadOperatorCtx();
  }, [loadOperatorCtx]);

  async function act(payload: Record<string, unknown>) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    setWave1Result(null);
    try {
      const r = await fetch("/api/pickup/switch", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j?.error || "Action failed.");
        return;
      }
      await load();
      if (payload?.action === "create_run" && j?.run_id) {
        const rid = String(j.run_id);
        setSelectedRunId(rid);
        await loadDetail(rid);
      } else if (selectedRunId) {
        await loadDetail(selectedRunId);
      }
      if (payload?.action === "launch_outreach" || payload?.action === "open_wave1") {
        setWave1Result({
          invited: Number(j?.invited || 0),
          handles: Array.isArray(j?.handles) ? j.handles.filter(Boolean) : [],
          dm_template: String(j?.dm_template || ""),
        });
      }
      setMsg("Saved.");
      await loadOperatorCtx();
    } finally {
      setBusy(false);
    }
  }

  const selectedRun = useMemo(() => detail?.run || null, [detail]);
  const auto = detail?.auto_status;
  const hubRun = runs.find((r: { is_current?: boolean }) => r.is_current);

  const launchBlockedReason = useMemo(() => {
    if (!selectedRun) return "Select a run.";
    if (selectedRun.outreach_started_at) return "Outreach already launched.";
    if (!auto?.anchor_start_at) return "Add at least one slot with kickoff time.";
    const h = auto.hours_until_start;
    if (h === null || h < 36) return "Kickoff must be at least 36 hours away.";
    return null;
  }, [selectedRun, auto]);

  const nextItems = useMemo(
    () => pickupNextSteps(selectedRun, detail, launchBlockedReason),
    [selectedRun, detail, launchBlockedReason],
  );

  if (!token) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl pt-2">
          <PageTop flush title="Staff · Pickups" fallbackHref={APP_HOME_URL} />
        </div>
        <div className="mx-auto max-w-4xl px-6 py-12 space-y-4">
          <div className="text-white/80">Log in to access admin tools.</div>
          <Link
            href="/login?next=/admin/pickup"
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const hubTitle = hubRun?.title || hubRun?.id || "—";
  const publishHref = selectedRunId ? `/admin/publish?run=${encodeURIComponent(selectedRunId)}` : "/admin/publish";

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl pt-2">
        <PageTop flush title="Staff · Pickups" fallbackHref={APP_HOME_URL} />
      </div>

      <div className="mx-auto max-w-6xl py-8 space-y-6 px-4 sm:px-0">
        <div className="text-sm text-white/55">
          <Link
            href="/admin/pickup/standing"
            className="text-white/80 underline-offset-4 hover:text-white hover:underline"
          >
            Player standing &amp; reliability
          </Link>
        </div>

        <OperatorLiveBar
          label="Live on hub"
          title={hubTitle}
          chip={hubRun ? { tone: "published", text: "On hub" } : { tone: "incomplete", text: "None" }}
          previewHref="/pickup"
        />

        {msg ? <div className="text-sm text-white/60">{msg}</div> : null}

        {selectedRunId && opCtx ? (
          <div className="space-y-4">
            <OperatorQuickActions
              publishHref={publishHref}
              previewPaths={[
                { href: "/pickup", label: "Pickup hub" },
                { href: "/pickup/upcoming-games", label: "Upcoming & join" },
                { href: "/status/pickup", label: "Pickup status" },
              ]}
            />
            <OperatorLatestLine
              title="Latest run post"
              body={opCtx.latestRunPost?.message ?? null}
              at={opCtx.latestRunPost?.created_at ? fmt(opCtx.latestRunPost.created_at) : null}
              empty="No posts for this run yet — publish one with this run selected."
            />
            <OperatorWhereAppears rows={opCtx.whereRows} tablesMissing={opCtx.tablesMissing} />
            <OperatorNextSteps items={nextItems} />
          </div>
        ) : selectedRunId && opCtxErr ? (
          <p className="text-sm text-red-300/90">Couldn’t load where posts appear or delivery status.</p>
        ) : selectedRunId ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/45">New run</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-white/80">
              <span>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                placeholder="Friday night run"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80">
              <span>Who can join</span>
              <select
                value={runType}
                onChange={(e) => setRunType(e.target.value as "select" | "public")}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="select">Invite only</option>
                <option value="public">Open tiers</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80">
              <span>Player capacity</span>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                min={1}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80">
              <span>Fee (cents)</span>
              <span className="text-xs text-white/45">Whole dollars × 100, e.g. 1500 = $15.00</span>
              <input
                type="number"
                value={feeCents}
                onChange={(e) => setFeeCents(Number(e.target.value))}
                min={0}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80 sm:col-span-2">
              <span>Venue preset</span>
              <select
                value={locationPreset}
                onChange={(e) => {
                  const next = e.target.value as "" | "new_haven" | "new_rochelle" | "other";
                  setLocationPreset(next);
                  if (next === "new_haven") setLocationPrivate(LOCATION_PRESETS.new_haven);
                  else if (next === "new_rochelle") setLocationPrivate(LOCATION_PRESETS.new_rochelle);
                  else if (next === "other") setLocationPrivate("");
                }}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="">Choose…</option>
                <option value="new_haven">New Haven</option>
                <option value="new_rochelle">New Rochelle</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70 sm:col-span-2">
              <input type="checkbox" checked={locConfirmedOnly} onChange={(e) => setLocConfirmedOnly(e.target.checked)} />
              Location visible to confirmed only
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-white/80">
            <span>Full venue text for players</span>
            <textarea
              value={locationPrivate}
              onChange={(e) => setLocationPrivate(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              act({
                action: "create_run",
                title,
                run_type: runType,
                capacity,
                fee_cents: feeCents,
                currency: "usd",
                location_private: locationPrivate || null,
                show_location_to_confirmed_only: locConfirmedOnly,
              })
            }
            className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
          >
            Create &amp; promote
          </button>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Pickup run</div>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="max-w-md rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
            >
              <option value="">Choose a run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {labelPickupRunStatus(r.status)} · {fmt(r.start_at)}
                </option>
              ))}
            </select>
          </div>

          {selectedRun ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                <span>{labelPickupRunStatus(String(selectedRun.status))}</span>
                <span>·</span>
                <span>{fmt(selectedRun.start_at)}</span>
                {selectedRun.is_current ? <span className="text-emerald-200/90">· on hub</span> : null}
              </div>
              <div className="text-xs text-white/40">Run ID: {String(selectedRun.id)}</div>
            </>
          ) : null}

          {selectedRun && !selectedRun.is_current && selectedRun.status !== "canceled" ? (
            <PromotePickupRunButton
              runId={selectedRun.id}
              title={selectedRun.title}
              onApplied={() => {
                void load();
                if (selectedRunId) void loadDetail(selectedRunId);
                void loadOperatorCtx();
              }}
            />
          ) : null}

          {detail?.counts ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  { key: "invites" as const, label: "Invites" },
                  { key: "available" as const, label: "Open spots" },
                  { key: "confirmed" as const, label: "Confirmed" },
                ] as const
              ).map(({ key: k, label }) => (
                <div key={k} className="rounded-lg border border-white/10 bg-black/40 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
                  <div className="text-lg font-semibold text-white">{detail.counts[k]}</div>
                </div>
              ))}
            </div>
          ) : null}

          {auto ? (
            <details className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/75">
              <summary className="cursor-pointer text-white/85">Auto pipeline</summary>
              <div className="mt-2 space-y-1 text-xs">
                <div>Next: {auto.next_step}</div>
                <div className="font-mono text-white/55">
                  24h {fmt(auto.checkpoints?.cp_24h_at)} · 12h {fmt(auto.checkpoints?.cp_12h_at)} · 6h{" "}
                  {fmt(auto.checkpoints?.cp_6h_at)} · 1h {fmt(auto.checkpoints?.cp_1h_at)}
                </div>
              </div>
            </details>
          ) : null}

          {selectedRunId ? (
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
              <button
                disabled={busy || !!launchBlockedReason}
                title={launchBlockedReason || undefined}
                onClick={() => act({ action: "launch_outreach", run_id: selectedRunId })}
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Launch outreach
              </button>
              <button
                disabled={busy}
                onClick={() => act({ action: "cancel_run", run_id: selectedRunId })}
                className="rounded-md border border-white/20 px-4 py-2 text-xs font-semibold text-white/85"
              >
                Cancel run
              </button>
            </div>
          ) : null}

          {wave1Result ? (
            <details className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-white/85">Outreach copy ({wave1Result.invited} invited)</summary>
              <textarea readOnly value={wave1Result.handles.join("\n")} className="mt-2 w-full bg-black text-xs text-white" rows={4} />
              <textarea readOnly value={wave1Result.dm_template} className="mt-2 w-full bg-black text-xs text-white" rows={5} />
            </details>
          ) : null}

          {selectedRunId ? (
            <div className="space-y-2 border-t border-white/10 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Kickoff slot</div>
              <div className="flex flex-wrap gap-2">
                <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-white/55">
                  <span>Kickoff date &amp; time</span>
                  <input
                    value={slotStart}
                    onChange={(e) => setSlotStart(e.target.value)}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                    placeholder="e.g. 2026-04-10T18:00:00"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/55">
                  <span>Label (optional)</span>
                  <input
                    value={slotLabel}
                    onChange={(e) => setSlotLabel(e.target.value)}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                    placeholder="Field 2"
                  />
                </label>
                <button
                  disabled={busy || !slotStart}
                  onClick={() => act({ action: "add_slot", run_id: selectedRunId, start_at: slotStart, label: slotLabel || null })}
                  className="rounded-md bg-white/90 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
                >
                  Add slot
                </button>
              </div>
            </div>
          ) : null}

          {selectedRunId && detail?.slots?.length ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Finalize</div>
              <select
                value={finalSlotId}
                onChange={(e) => setFinalSlotId(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="">Slot…</option>
                {detail.slots.map((s: { id: string; start_at: string; label?: string }) => (
                  <option key={s.id} value={s.id}>
                    {fmt(s.start_at)} {s.label ? `· ${s.label}` : ""}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !finalSlotId}
                onClick={() => act({ action: "finalize_slot", run_id: selectedRunId, slot_id: finalSlotId })}
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Finalize slot
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
