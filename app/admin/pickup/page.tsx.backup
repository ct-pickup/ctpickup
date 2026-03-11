"use client";

import PageTop from "@/components/PageTop";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function fmt(dt: string | null) {
  if (!dt) return "TBD";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "TBD";
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

export default function AdminPickupPage() {
  const [token, setToken] = useState<string | null>(null);
  const [meAdmin, setMeAdmin] = useState<boolean>(false);

  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [detail, setDetail] = useState<any | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
const [wave1Result, setWave1Result] = useState<{
  invited: number;
  handles: string[];
  dm_template: string;
} | null>(null);

  // create run form
  const [title, setTitle] = useState("CT Pickup Run");
  const [runType, setRunType] = useState<"select" | "public">("select");
  const [capacity, setCapacity] = useState(18);
  const [feeCents, setFeeCents] = useState(0);
  const [locationPrivate, setLocationPrivate] = useState("");
const [locConfirmedOnly, setLocConfirmedOnly] = useState(true);
const [locationPreset, setLocationPreset] = useState<
  "" | "new_haven" | "new_rochelle" | "other"
>("");

  // add slot form
  const [slotStart, setSlotStart] = useState("");
  const [slotLabel, setSlotLabel] = useState("");

  // finalize slot
  const [finalSlotId, setFinalSlotId] = useState("");

  // updates
  const [globalUpdate, setGlobalUpdate] = useState("");
  const [runUpdate, setRunUpdate] = useState("");

  async function load() {
    if (!token) return;
    setMsg(null);

    // basic admin check via /api/pickup/public (me.is_admin exists)
    const pr = await fetch("/api/pickup/public", { headers: { Authorization: `Bearer ${token}` } });
    const pj = await pr.json();
    setMeAdmin(!!pj?.me?.is_admin);

    const r = await fetch("/api/pickup/switch", { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    setRuns(j?.runs || []);
  }

  async function loadDetail(runId: string) {
    if (!token || !runId) return;
    setMsg(null);

    const r = await fetch(`/api/pickup/switch?run_id=${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    setDetail(j);
    setFinalSlotId("");
  }

  useEffect(() => {
    (async () => {
      const s = await supabase.auth.getSession();
      const t = s.data.session?.access_token || null;
      setToken(t);
    })();
  }, []);

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedRunId) loadDetail(selectedRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  async function act(payload: any) {
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
if (selectedRunId) await loadDetail(selectedRunId);

if (payload?.action === "open_wave1") {
  setWave1Result({
    invited: Number(j?.invited || 0),
    handles: Array.isArray(j?.handles) ? j.handles.filter(Boolean) : [],
    dm_template: String(j?.dm_template || ""),
  });
  setMsg("Wave 1 opened.");
} else {
  setMsg("Done.");
}
    } finally {
      setBusy(false);
    }
  }

  const selectedRun = useMemo(() => {
    return detail?.run || null;
  }, [detail]);

  if (!token) {
    return (
      <main className="min-h-screen bg-black text-white">
        <PageTop title="ADMIN" />
        <div className="mx-auto max-w-4xl px-6 py-12 space-y-4">
          <div className="text-white/80">Log in to access admin tools.</div>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
          >
            LOG IN
          </Link>
        </div>
      </main>
    );
  }

  if (!meAdmin) {
    return (
      <main className="min-h-screen bg-black text-white">
        <PageTop title="ADMIN" />
        <div className="mx-auto max-w-4xl px-6 py-12 space-y-4">
          <div className="text-white/80">Forbidden. Your account is not marked as admin.</div>
          <div className="text-sm text-white/60">Set profiles.is_admin = true for your user in Supabase.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="ADMIN · PICKUP" />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        {msg ? <div className="text-sm text-white/70">{msg}</div> : null}

        {/* Create run */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-5">
          <div className="text-lg font-semibold uppercase tracking-wide text-white/90">
            Create a new pickup run
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
  <div className="space-y-2">
    <div className="text-xs uppercase tracking-widest text-white/55">Run title</div>
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
      placeholder="CT Pickup Run"
    />
  </div>

  <div className="space-y-2">
    <div className="text-xs uppercase tracking-widest text-white/55">Entry type</div>
    <select
      value={runType}
      onChange={(e) => setRunType(e.target.value as any)}
      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
    >
      <option value="select">Invite only</option>
      <option value="public">Open to all 4 tiers</option>
    </select>
  </div>

  <div className="space-y-2">
    <div className="text-xs uppercase tracking-widest text-white/55">Capacity</div>
    <input
      type="number"
      value={capacity}
      onChange={(e) => setCapacity(Number(e.target.value))}
      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
      placeholder="18"
    />
  </div>

  <div className="space-y-2">
    <div className="text-xs uppercase tracking-widest text-white/55">Price per person</div>
    <input
      type="number"
      value={feeCents}
      onChange={(e) => setFeeCents(Number(e.target.value))}
      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
      placeholder="0"
    />
  </div>

  <div className="space-y-2 sm:col-span-2">
    <div className="text-xs uppercase tracking-widest text-white/55">Location preset</div>
    <select
      value={locationPreset}
      onChange={(e) => {
        const next = e.target.value as "" | "new_haven" | "new_rochelle" | "other";
        setLocationPreset(next);

        if (next === "new_haven") {
          setLocationPrivate(LOCATION_PRESETS.new_haven);
        } else if (next === "new_rochelle") {
          setLocationPrivate(LOCATION_PRESETS.new_rochelle);
        } else if (next === "other") {
          setLocationPrivate("");
        }
      }}
      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
    >
      <option value="">Choose a location preset…</option>
      <option value="new_haven">New Haven SoccerRoof</option>
      <option value="new_rochelle">New Rochelle SoccerRoof</option>
      <option value="other">Other — enter manually</option>
    </select>
  </div>

  <div className="sm:col-span-2">
    <label className="flex items-center gap-3 text-sm text-white/75">
      <input
        type="checkbox"
        checked={locConfirmedOnly}
        onChange={(e) => setLocConfirmedOnly(e.target.checked)}
      />
      Only confirmed players can see this info
    </label>
  </div>
</div>

<textarea
  value={locationPrivate}
  onChange={(e) => setLocationPrivate(e.target.value)}
  className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
  rows={9}
  placeholder="Choose New Haven SoccerRoof, New Rochelle SoccerRoof, or Other — enter manually."
/>

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
            className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Create pickup run
          </button>
        </section>

        {/* Select run */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-5">
          <div className="text-lg font-semibold uppercase tracking-wide text-white/90">
            Manage an existing pickup run
          </div>

          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
          >
            <option value="">Choose a pickup run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {r.status} · {fmt(r.start_at)}
              </option>
            ))}
          </select>

          {selectedRun ? (
            <div className="text-sm text-white/70">
              <div>Run ID: {selectedRun.id}</div>
              <div>Status: {selectedRun.status}</div>
              <div>Start: {fmt(selectedRun.start_at)}</div>
              <div>Open tier rank: {selectedRun.open_tier_rank ?? "null"}</div>
              <div>Likely-on slot: {selectedRun.likely_on_slot_id ?? "null"}</div>
              <div>Final slot: {selectedRun.final_slot_id ?? "null"}</div>
            </div>
          ) : null}

          {detail?.counts ? (
            <div className="grid gap-3 sm:grid-cols-3 pt-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="text-xs uppercase tracking-widest text-white/55">Invites</div>
                <div className="mt-2 text-2xl font-semibold text-white/90">{detail.counts.invites}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="text-xs uppercase tracking-widest text-white/55">Available</div>
                <div className="mt-2 text-2xl font-semibold text-white/90">{detail.counts.available}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="text-xs uppercase tracking-widest text-white/55">Confirmed</div>
                <div className="mt-2 text-2xl font-semibold text-white/90">{detail.counts.confirmed}</div>
              </div>
            </div>
          ) : null}

          {/* Add slot */}
          {selectedRunId ? (
            <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Add time slot</div>

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
                  placeholder="start_at (ISO) e.g. 2026-03-09T20:00:00-04:00"
                />
                <input
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
                  placeholder="optional label"
                />
              </div>

              <button
                disabled={busy || !slotStart}
                onClick={() => act({ action: "add_slot", run_id: selectedRunId, start_at: slotStart, label: slotLabel || null })}
                className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
              >
                Add slot
              </button>
            </div>
          ) : null}

          {/* Wave 1 + finalize */}
          {selectedRunId ? (
  <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      <button
        disabled={busy}
        onClick={() => act({ action: "open_wave1", run_id: selectedRunId })}
        className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        Open Wave 1 (Tier 1A + 1B)
      </button>

      <button
        disabled={busy}
        onClick={() => act({ action: "cancel_run", run_id: selectedRunId })}
        className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
      >
        Cancel run
      </button>
    </div>

    {wave1Result ? (
      <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
        <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
          Wave 1 DM
        </div>

        <div className="text-sm text-white/70">
          Invited: {wave1Result.invited}
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-white/55">Instagram handles</div>
          <textarea
            readOnly
            value={wave1Result.handles.join("\n")}
            className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
            rows={Math.max(4, Math.min(12, wave1Result.handles.length || 4))}
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-white/55">DM template</div>
          <textarea
            readOnly
            value={wave1Result.dm_template}
            className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
            rows={7}
          />
        </div>
      </div>
    ) : null}
  </div>
) : null}

          {/* Finalize slot */}
          {selectedRunId && detail?.slots?.length ? (
            <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Finalize winning slot (sets start_at + active)
              </div>

              <select
                value={finalSlotId}
                onChange={(e) => setFinalSlotId(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">Select a slot…</option>
                {detail.slots.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {fmt(s.start_at)} {s.label ? `· ${s.label}` : ""}
                  </option>
                ))}
              </select>

              <button
                disabled={busy || !finalSlotId}
                onClick={() => act({ action: "finalize_slot", run_id: selectedRunId, slot_id: finalSlotId })}
                className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
              >
                Finalize slot
              </button>
            </div>
          ) : null}

          {/* Post updates */}
          <div className="grid gap-6 pt-2 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Send update for all players</div>
              <textarea
                value={globalUpdate}
                onChange={(e) => setGlobalUpdate(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
                rows={4}
                placeholder="Message for all players"
              />
              <button
  disabled={busy || !globalUpdate.trim()}
  onClick={() => act({ action: "post_update", run_id: null, message: globalUpdate })}
  className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
>
  Send Update For All Players
</button>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Post update for this run</div>
              <textarea
                value={runUpdate}
                onChange={(e) => setRunUpdate(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
                rows={4}
                placeholder="Message for the selected run"
              />
              <button
  disabled={busy || !runUpdate.trim() || !selectedRunId}
  onClick={() => act({ action: "post_update", run_id: selectedRunId, message: runUpdate })}
  className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
>
  Send Run Update
</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}