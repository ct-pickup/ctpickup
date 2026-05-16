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
import {
  defaultPickupWorkflowTab,
  derivePickupLifecycleStage,
  pickupLifecycleStageLabel,
  pickupWorkflowTabForRun,
  showEditSettingsButton,
  showEndRunButton,
  showFinalizeTimeButton,
  showLaunchOutreachButton,
  showPostResultsForPast,
  showPromoteToHubButton,
  showStartRunNowButton,
  showViewResultsForPast,
  type PickupWorkflowTab,
} from "@/lib/admin/pickupRunLifecycle";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";

const LIME = "#a3e635";

function fmtEt(dt: string | null) {
  if (!dt) return "No time set yet";
  try {
    return new Date(dt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtEtShort(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function parseEtDatetimeLocalToIso(localVal: string): string | null {
  const trimmed = localVal.trim();
  if (!trimmed) return null;
  const dt = DateTime.fromISO(trimmed, { zone: "America/New_York" });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
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
  const publicRun = isPublicPickupRunType(selectedRun.run_type);
  if (!publicRun && !selectedRun.outreach_started_at) {
    if (launchBlockedReason) out.push(launchBlockedReason);
    else if (slots) out.push("Begin outreach phase, then invite Select players from the mobile admin app.");
  }
  if (!selectedRun.final_slot_id && String(selectedRun.status) !== "active") {
    out.push("Finalize a slot for RSVP.");
  }
  return out;
}

type PickupSwitchDetail = {
  run?: Record<string, unknown> | null;
  slots?: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
  auto_status?: Record<string, unknown>;
};

export default function PickupOperatorClient() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, any>[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [detail, setDetail] = useState<PickupSwitchDetail | null>(null);
  const [opCtx, setOpCtx] = useState<PickupOperatorBundle | null>(null);
  const [opCtxErr, setOpCtxErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wave1Result, setWave1Result] = useState<{
    invited: number;
    handles: string[];
    dm_template: string;
  } | null>(null);
  const [workflowTabOverride, setWorkflowTabOverride] = useState<PickupWorkflowTab | null>(null);

  const [title, setTitle] = useState("CT Pickup Run");
  const [runType, setRunType] = useState<"select" | "public">("select");
  const [capacity, setCapacity] = useState(18);
  const [feeCents, setFeeCents] = useState(0);
  const [locationPrivate, setLocationPrivate] = useState("");
  const [locConfirmedOnly, setLocConfirmedOnly] = useState(true);
  const [locationPreset, setLocationPreset] = useState<"" | "new_haven" | "new_rochelle" | "other">("");
  const [createServiceRegion, setCreateServiceRegion] = useState<"CT" | "NY" | "NJ" | "MD">("CT");
  const [createKickoffLocal, setCreateKickoffLocal] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [finalSlotId, setFinalSlotId] = useState("");

  /** Selected run — persisted settings (synced from API; saved via `edit_run`). */
  const [selTitle, setSelTitle] = useState("");
  const [selRunType, setSelRunType] = useState<"select" | "public">("select");
  const [selCapacity, setSelCapacity] = useState(18);
  const [selFeeCents, setSelFeeCents] = useState(0);
  const [selLocationPrivate, setSelLocationPrivate] = useState("");
  const [selLocConfirmedOnly, setSelLocConfirmedOnly] = useState(true);

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
      const j = (await r.json()) as PickupSwitchDetail;
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

  useEffect(() => {
    if (!selectedRunId) {
      setSelTitle("");
      setSelRunType("select");
      setSelCapacity(18);
      setSelFeeCents(0);
      setSelLocationPrivate("");
      setSelLocConfirmedOnly(true);
      return;
    }
    const fromDetail = detail?.run as Record<string, unknown> | null | undefined;
    if (fromDetail && String(fromDetail.id || "") === selectedRunId) {
      setSelTitle(String(fromDetail.title ?? ""));
      setSelRunType(isPublicPickupRunType(fromDetail.run_type) ? "public" : "select");
      setSelCapacity(Number(fromDetail.capacity ?? 18));
      setSelFeeCents(Number(fromDetail.fee_cents ?? 0));
      setSelLocationPrivate(fromDetail.location_private != null ? String(fromDetail.location_private) : "");
      setSelLocConfirmedOnly(fromDetail.show_location_to_confirmed_only !== false);
      return;
    }
    const fromList = runs.find((r) => String(r.id) === selectedRunId) as Record<string, unknown> | undefined;
    if (fromList) {
      setSelTitle(String(fromList.title ?? ""));
      setSelRunType(isPublicPickupRunType(fromList.run_type) ? "public" : "select");
      setSelCapacity(Number(fromList.capacity ?? 18));
      setSelFeeCents(Number(fromList.fee_cents ?? 0));
      setSelLocationPrivate(fromList.location_private != null ? String(fromList.location_private) : "");
      setSelLocConfirmedOnly(fromList.show_location_to_confirmed_only !== false);
    }
  }, [detail?.run, selectedRunId, runs]);

  async function act(payload: Record<string, unknown>) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    setWave1Result(null);
    try {
      console.log("[PickupOperatorClient] POST /api/pickup/switch", JSON.stringify(payload));
      if (payload?.action === "add_slot") {
        console.log("[PickupOperatorClient] add_slot start_at value", payload.start_at);
      }
      const r = await fetch("/api/pickup/switch", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) {
        console.error("[PickupOperatorClient] POST /api/pickup/switch failed", r.status, j);
        setMsg(j?.error || "Action failed.");
        return;
      }
      if (payload?.action === "add_slot") {
        setSlotStart("");
        setSlotLabel("");
      }
      await load();
      if (payload?.action === "create_run" && j?.run_id) {
        const rid = String(j.run_id);
        setWorkflowTabOverride("planning");
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
      const action = String(payload?.action || "");
      let success = "Saved.";
      if (action === "create_run") success = "Run created — it appears under Planning until you promote it to the hub.";
      else if (action === "edit_run") success = "Run settings saved.";
      else if (action === "finalize_slot") success = "Time finalized — run is active for RSVP.";
      else if (action === "add_slot") success = "Kickoff slot saved.";
      else if (action === "launch_outreach") success = "Outreach phase marked. For Select runs, invite players from the mobile admin Invite players screen.";
      else if (action === "cancel_run") success = "Run canceled.";
      else if (action === "start_run_now") success = "Pickup started.";
      setMsg(success);
      await loadOperatorCtx();
    } finally {
      setBusy(false);
    }
  }

  async function endRunNow(runId: string) {
    if (!token) return;
    if (!window.confirm("End this pickup run? You can mark results after.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/pickup/end-run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Could not end run.");
        return;
      }
      setMsg("Run ended.");
      await load();
      if (selectedRunId === runId) await loadDetail(runId);
      await loadOperatorCtx();
    } finally {
      setBusy(false);
    }
  }

  async function promoteHubRun(runId: string) {
    if (!token) return;
    if (!window.confirm("Promote this run to the regional pickup hub? Players will see it on /pickup for that state.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_hub_pickup", run_id: runId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not promote run.");
        return;
      }
      setMsg("Promoted to hub.");
      await load();
      if (selectedRunId === runId) await loadDetail(runId);
      await loadOperatorCtx();
    } finally {
      setBusy(false);
    }
  }

  function launchBlockedForRunRow(row: Record<string, unknown>): string | null {
    if (row.outreach_started_at) return "Outreach already launched.";
    const st = row.start_at != null ? String(row.start_at).trim() : "";
    if (!st) return "Add a kickoff slot first.";
    const ms = Date.parse(st);
    if (!Number.isFinite(ms)) return "Add a kickoff slot first.";
    return null;
  }

  const selectedRun = useMemo(() => detail?.run || null, [detail]);
  const auto = detail?.auto_status;
  const hubRun = runs.find((r: { is_current?: boolean }) => r.is_current);

  const workflowTabCounts = useMemo(() => {
    const c: Record<PickupWorkflowTab, number> = { planning: 0, active: 0, past: 0 };
    for (const r of runs) {
      c[pickupWorkflowTabForRun(r)]++;
    }
    return c;
  }, [runs]);

  const workflowTab = workflowTabOverride ?? defaultPickupWorkflowTab(workflowTabCounts);

  const visibleRuns = useMemo(() => {
    return runs.filter((r) => pickupWorkflowTabForRun(r) === workflowTab);
  }, [runs, workflowTab]);

  const launchBlockedReason = useMemo(() => {
    if (!selectedRun) return "Select a run.";
    return launchBlockedForRunRow(selectedRun as Record<string, unknown>);
  }, [selectedRun]);

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

  const hubTitle = (hubRun?.title || hubRun?.id || "—") as string;
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
              at={opCtx.latestRunPost?.created_at ? fmtEtShort(opCtx.latestRunPost.created_at) : null}
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
                <option value="select">Select (invite)</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80">
              <span>State / region</span>
              <select
                value={createServiceRegion}
                onChange={(e) => setCreateServiceRegion(e.target.value as "CT" | "NY" | "NJ" | "MD")}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="CT">CT</option>
                <option value="NY">NY</option>
                <option value="NJ">NJ</option>
                <option value="MD">MD</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/80 sm:col-span-2">
              <span>Date &amp; time (Eastern)</span>
              <input
                type="datetime-local"
                value={createKickoffLocal}
                onChange={(e) => setCreateKickoffLocal(e.target.value)}
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              />
              <span className="text-xs text-white/45">Stored in UTC; displayed in ET everywhere in admin.</span>
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
            onClick={() => {
              const iso = parseEtDatetimeLocalToIso(createKickoffLocal);
              if (!iso) {
                setMsg("Pick a kickoff date and time (Eastern).");
                return;
              }
              void act({
                action: "create_run",
                title: title.trim() || "CT Pickup Run",
                run_type: runType,
                capacity,
                fee_cents: feeCents,
                currency: "usd",
                location_private: locationPrivate.trim() || null,
                show_location_to_confirmed_only: locConfirmedOnly,
                service_region: createServiceRegion,
                start_at: iso,
              });
            }}
            className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
          >
            Create run
          </button>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Pickup runs</div>
          <div className="flex flex-wrap gap-2">
            {(["planning", "active", "past"] as const).map((tab) => {
              const active = workflowTab === tab;
              const count = workflowTabCounts[tab];
              const label = tab === "planning" ? "Planning" : tab === "active" ? "Active" : "Past";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setWorkflowTabOverride(tab)}
                  className={[
                    "rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#a3e63514] text-[#d9f99d]"
                      : "border-white/15 bg-black/30 text-white/70 hover:border-white/25",
                  ].join(" ")}
                  style={active ? { borderColor: `${LIME}55` } : undefined}
                >
                  {label}
                  <span className="ml-1.5 text-white/45">({count})</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {visibleRuns.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-6 text-sm text-white/55 sm:col-span-2">
                No runs in this tab.
              </div>
            ) : (
              visibleRuns.map((r: Record<string, unknown>) => {
                const id = String(r.id || "");
                if (!id) return null;
                const selected = selectedRunId === id;
                const stage = derivePickupLifecycleStage({
                  status: r.status as string,
                  is_current: !!r.is_current,
                  outreach_started_at: r.outreach_started_at as string | null,
                  is_completed: r.is_completed === true,
                  has_result: r.has_result === true,
                });
                const pillLabel = pickupLifecycleStageLabel(stage);
                return (
                  <div
                    key={id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRunId(id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRunId(id);
                      }
                    }}
                    className={[
                      "cursor-pointer rounded-xl border p-4 text-left transition-colors",
                      selected
                        ? "border-[#a3e63555] bg-[#a3e63510]"
                        : "border-white/10 bg-black/30 hover:border-white/20",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{String(r.title || "Pickup run")}</div>
                        <div className="mt-1 text-xs text-white/50">{fmtEt(r.start_at as string | null)}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white/80">
                            {isPublicPickupRunType(r.run_type) ? "Public" : "Select"}
                          </span>
                          <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white/80">
                            {r.service_region ? String(r.service_region) : "—"}
                          </span>
                        </div>
                      </div>
                      {r.is_current ? (
                        <span className="shrink-0 rounded-full border border-[#a3e63544] bg-[#a3e63512] px-2 py-0.5 text-[10px] font-bold text-[#d9f99d]">
                          HUB
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 inline-flex rounded-full border border-white/12 bg-black/40 px-3 py-1 text-[11px] font-semibold text-white/85">
                      {pillLabel}
                    </div>
                    {(() => {
                      const lc = (r.list_counts as Record<string, number> | undefined) ?? {};
                      const confirmed = Number(lc.confirmed ?? 0) || 0;
                      const standby = Number(lc.standby ?? 0) || 0;
                      const waitlist = Number(lc.waitlist ?? 0) || 0;
                      const pending = Number(lc.pending_payment ?? 0) || 0;
                      return (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/55 sm:grid-cols-4">
                          <div>
                            <span className="block text-white/40">Confirmed</span>
                            <span className="font-semibold text-white/90">{confirmed}</span>
                          </div>
                          <div>
                            <span className="block text-white/40">Standby</span>
                            <span className="font-semibold text-white/90">{standby}</span>
                          </div>
                          <div>
                            <span className="block text-white/40">Waitlist</span>
                            <span className="font-semibold text-white/90">{waitlist}</span>
                          </div>
                          <div>
                            <span className="block text-white/40">Pending $</span>
                            <span className="font-semibold text-white/90">{pending}</span>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {workflowTab === "past" ? (
                        <>
                          {showPostResultsForPast({
                            status: r.status as string,
                            is_completed: r.is_completed === true,
                            has_result: r.has_result === true,
                          }) ? (
                            <Link
                              href={`/admin/run-result?run_id=${encodeURIComponent(id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center rounded-full bg-[#a3e635] px-3 py-1.5 text-[11px] font-semibold text-black"
                            >
                              Post Results
                            </Link>
                          ) : null}
                          {showViewResultsForPast({ has_result: r.has_result === true }) ? (
                            <Link
                              href={`/admin/run-result?run_id=${encodeURIComponent(id)}&readonly=1`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center rounded-full border border-white/25 px-3 py-1.5 text-[11px] font-semibold text-white/90"
                            >
                              View Results
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {showPromoteToHubButton({
                            status: r.status as string,
                            is_current: !!r.is_current,
                            is_completed: r.is_completed === true,
                          }) ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void promoteHubRun(id);
                              }}
                              className="rounded-full border border-[#a3e63555] bg-[#a3e63514] px-3 py-1.5 text-[11px] font-semibold text-[#d9f99d] disabled:opacity-50"
                            >
                              Promote to hub
                            </button>
                          ) : null}
                          {showLaunchOutreachButton({
                            status: r.status as string,
                            run_type: r.run_type,
                            outreach_started_at: r.outreach_started_at as string | null,
                            is_completed: r.is_completed === true,
                          }) ? (
                            <button
                              type="button"
                              disabled={busy || !!launchBlockedForRunRow(r)}
                              title={launchBlockedForRunRow(r) || undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRunId(id);
                                const origin = typeof window !== "undefined" ? window.location.origin : "";
                                void act({
                                  action: "launch_outreach",
                                  run_id: id,
                                  run_link: origin ? `${origin.replace(/\/$/, "")}/pickup` : "/pickup",
                                  date_or_tbd: r.start_at ? fmtEtShort(String(r.start_at)) : "TBD",
                                });
                              }}
                              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                            >
                              Launch outreach phase
                            </button>
                          ) : null}
                          {showFinalizeTimeButton({
                            status: r.status as string,
                            is_completed: r.is_completed === true,
                            final_slot_id: r.final_slot_id as string | null,
                          }) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRunId(id);
                              }}
                              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white"
                            >
                              Finalize time
                            </button>
                          ) : null}
                          {showEditSettingsButton({
                            status: r.status as string,
                            is_completed: r.is_completed === true,
                          }) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRunId(id);
                              }}
                              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white"
                            >
                              Edit settings
                            </button>
                          ) : null}
                          {showStartRunNowButton({
                            status: r.status as string,
                            is_completed: r.is_completed === true,
                            start_at: r.start_at as string | null,
                          }) ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (typeof window !== "undefined") {
                                  const ok = window.confirm(
                                    "Begin pickup now? This locks the roster — no new players will be able to join.",
                                  );
                                  if (!ok) return;
                                }
                                void act({ action: "start_run_now", run_id: id });
                              }}
                              className="rounded-full bg-[#a3e635] px-3 py-1.5 text-[11px] font-semibold text-black disabled:opacity-50"
                            >
                              Begin Pickup Now
                            </button>
                          ) : null}
                          {showEndRunButton({ status: r.status as string, is_completed: r.is_completed === true }) ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void endRunNow(id);
                              }}
                              className="rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-200 disabled:opacity-50"
                            >
                              End Run
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Selected run</div>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="max-w-md rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
            >
              <option value="">Choose a run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {labelPickupRunStatus(r.status)} · {fmtEt(r.start_at as string | null)}
                </option>
              ))}
            </select>
          </div>

          {selectedRun ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                <span>{labelPickupRunStatus(String(selectedRun.status))}</span>
                <span>·</span>
                <span>{fmtEt(selectedRun.start_at as string | null)}</span>
                {selectedRun.is_current ? <span className="text-emerald-200/90">· on hub</span> : null}
              </div>
              <div className="text-xs text-white/40">Run ID: {String(selectedRun.id)}</div>
            </>
          ) : null}

          {selectedRunId && selectedRun && selectedRun.status !== "canceled" ? (
            <div className="space-y-3 rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Run settings</div>
              <p className="text-xs text-white/50">
                Who can join, capacity, fee, and venue text apply to this run. Save after changes.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-white/80">
                  <span>Title</span>
                  <input
                    value={selTitle}
                    onChange={(e) => setSelTitle(e.target.value)}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-white/80">
                  <span>Who can join</span>
                  <select
                    value={selRunType}
                    onChange={(e) => setSelRunType(e.target.value as "select" | "public")}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  >
                    <option value="select">Select (invite)</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-white/80">
                  <span>Player capacity</span>
                  <input
                    type="number"
                    value={selCapacity}
                    onChange={(e) => setSelCapacity(Number(e.target.value))}
                    min={1}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-white/80">
                  <span>Fee (cents)</span>
                  <input
                    type="number"
                    value={selFeeCents}
                    onChange={(e) => setSelFeeCents(Number(e.target.value))}
                    min={0}
                    className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={selLocConfirmedOnly}
                  onChange={(e) => setSelLocConfirmedOnly(e.target.checked)}
                />
                Location visible to confirmed only
              </label>
              <label className="flex flex-col gap-1 text-sm text-white/80">
                <span>Full venue text for players</span>
                <textarea
                  value={selLocationPrivate}
                  onChange={(e) => setSelLocationPrivate(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act({
                    action: "edit_run",
                    run_id: selectedRunId,
                    title: selTitle,
                    run_type: selRunType,
                    capacity: selCapacity,
                    fee_cents: selFeeCents,
                    currency: "usd",
                    location_private: selLocationPrivate.trim() || null,
                    show_location_to_confirmed_only: selLocConfirmedOnly,
                  })
                }
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Save run settings
              </button>
            </div>
          ) : null}

          {selectedRun &&
          showPromoteToHubButton({
            status: String(selectedRun.status || ""),
            is_current: !!selectedRun.is_current,
            is_completed: selectedRun.is_completed === true,
          }) ? (
            <PromotePickupRunButton
              runId={selectedRun.id as string}
              title={selectedRun.title as string}
              onApplied={() => {
                void load();
                if (selectedRunId) void loadDetail(selectedRunId);
                void loadOperatorCtx();
              }}
            />
          ) : null}

          {detail?.counts ? (
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {(
                [
                  { key: "invites" as const, label: "Invites" },
                  { key: "available" as const, label: "Open spots" },
                  { key: "confirmed" as const, label: "Confirmed" },
                  { key: "waitlist" as const, label: "Waitlist" },
                ] as const
              ).map(({ key: k, label }) => (
                <div key={k} className="rounded-lg border border-white/10 bg-black/40 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
                  <div className="text-lg font-semibold text-white">{detail.counts?.[k]}</div>
                </div>
              ))}
            </div>
          ) : null}

          {auto ? (
            <details className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/75">
              <summary className="cursor-pointer text-white/85">Auto pipeline</summary>
              <div className="mt-2 space-y-1 text-xs">
                <div>Next: {String(auto.next_step)}</div>
                <div className="font-mono text-white/55">
                  24h {fmtEtShort((auto as any).checkpoints?.cp_24h_at)} · 12h{" "}
                  {fmtEtShort((auto as any).checkpoints?.cp_12h_at)} · 6h{" "}
                  {fmtEtShort((auto as any).checkpoints?.cp_6h_at)} · 1h{" "}
                  {fmtEtShort((auto as any).checkpoints?.cp_1h_at)}
                </div>
              </div>
            </details>
          ) : null}

          {selectedRunId &&
          selectedRun &&
          showLaunchOutreachButton({
            status: String(selectedRun.status || ""),
            run_type: selectedRun.run_type,
            outreach_started_at: selectedRun.outreach_started_at as string | null,
            is_completed: selectedRun.is_completed === true,
          }) ? (
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
              <button
                disabled={busy || !!launchBlockedReason}
                title={launchBlockedReason || undefined}
                onClick={() => {
                  const origin = typeof window !== "undefined" ? window.location.origin : "";
                  void act({
                    action: "launch_outreach",
                    run_id: selectedRunId,
                    run_link: origin ? `${origin.replace(/\/$/, "")}/pickup` : "/pickup",
                    date_or_tbd: selectedRun.start_at ? fmtEtShort(String(selectedRun.start_at)) : "TBD",
                  });
                }}
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Launch outreach phase
              </button>
              <button
                disabled={busy}
                onClick={() => act({ action: "cancel_run", run_id: selectedRunId })}
                className="rounded-md border border-white/20 px-4 py-2 text-xs font-semibold text-white/85"
              >
                Cancel run
              </button>
            </div>
          ) : selectedRunId ? (
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
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
                    placeholder="UTC ISO, e.g. 2026-04-10T22:00:00.000Z"
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
                {(detail.slots as { id: string; start_at: string; label?: string }[]).map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtEt(s.start_at as string | null)} {s.label ? `· ${s.label}` : ""}
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
