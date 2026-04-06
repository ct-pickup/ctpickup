"use client";

import Link from "next/link";
import PageTop from "@/components/PageTop";
import { pickupAutoCodeLabel } from "@/lib/pickup/standing/autoCodeLabels";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useCallback, useEffect, useMemo, useState } from "react";

type StandingRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  tier: string | null;
  confirmed_count: number | null;
  attended_count: number | null;
  strike_count: number | null;
  reliability_tracked_pickups: number | null;
  reliability_score_pct: number | null;
  reliability_bucket: "building" | "good" | "watch" | "needs_review" | string | null;
  waiver_current: boolean;
  effective_standing: string;
  auto_standing: string;
  manual_override: string | null;
  join_ok: boolean;
  standing: {
    manual_reason: string | null;
    staff_notes: string | null;
    auto_codes: string[];
    rollup_no_shows_90d: number;
    rollup_late_cancels_90d: number;
    rollup_pickup_payment_issues_90d: number;
    updated_at: string | null;
  } | null;
};

function chipTone(eff: string): string {
  switch (eff) {
    case "good":
      return "border-emerald-400/50 bg-emerald-400/10 text-emerald-100";
    case "warning":
      return "border-amber-400/50 bg-amber-400/10 text-amber-50";
    case "suspended":
      return "border-orange-400/50 bg-orange-400/10 text-orange-50";
    case "banned":
      return "border-red-400/55 bg-red-400/10 text-red-100";
    default:
      return "border-white/15 bg-white/[0.06] text-white/80";
  }
}

function reliabilityLabel(row: StandingRow): string {
  const tracked = row.reliability_tracked_pickups || 0;
  const score = row.reliability_score_pct;
  const bucket = row.reliability_bucket;

  if (tracked < 3 || score == null) {
    return "Building rating · starts after 3 pickups";
  }

  if (bucket === "good") {
    return `Good Standing · ${Math.round(score)}%`;
  }

  if (bucket === "watch" || bucket === "needs_review") {
    return `Reliability · ${Math.round(score)}%`;
  }

  return `Reliability · ${Math.round(score)}%`;
}

export default function PickupStandingAdminClient() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [reliabilityFilter, setReliabilityFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [waiverVersion, setWaiverVersion] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [edit, setEdit] = useState<StandingRow | null>(null);
  const [manual, setManual] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isReady || !supabase) return;
    void supabase.auth.getSession().then((s) => {
      setToken(s.data.session?.access_token || null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setMsg(null);
    try {
      const sp = new URLSearchParams();
      sp.set("filter", filter);
      if (q.trim()) sp.set("q", q.trim());
      const r = await fetch(`/api/admin/pickup/standing?${sp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error || "Could not load.");
        setRows([]);
        return;
      }
      setRows(Array.isArray(j?.rows) ? j.rows : []);
      setWaiverVersion(String(j?.currentWaiverVersion || ""));
    } finally {
      setLoading(false);
    }
  }, [token, filter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayedRows = useMemo(() => {
    if (reliabilityFilter === "all") return rows;

    if (reliabilityFilter === "good") {
      return rows.filter((r) => r.reliability_bucket === "good");
    }

    if (reliabilityFilter === "building") {
      return rows.filter((r) => r.reliability_bucket === "building" || r.reliability_score_pct == null);
    }

    // below standard
    return rows.filter((r) => r.reliability_bucket === "watch" || r.reliability_bucket === "needs_review");
  }, [rows, reliabilityFilter]);

  function openEdit(row: StandingRow) {
    setEdit(row);
    setManual(row.manual_override || "");
    setReason(row.standing?.manual_reason || "");
    setNotes(row.standing?.staff_notes || "");
  }

  async function saveEdit(clearOverride: boolean) {
    if (!token || !edit) return;
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        user_id: edit.user_id,
        manual_standing: clearOverride ? null : manual === "" ? null : manual,
        manual_reason: reason.trim() || null,
        staff_notes: notes.trim() || null,
      };
      const r = await fetch("/api/admin/pickup/standing", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error || "Save failed.");
        return;
      }
      setEdit(null);
      await load();
      setMsg("Saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl pt-2">
          <PageTop flush title="Staff · Pickup standing" fallbackHref={APP_HOME_URL} />
        </div>
        <div className="mx-auto max-w-4xl px-6 py-12 space-y-4">
          <p className="text-white/80">Log in to access admin tools.</p>
          <Link
            href="/login?next=/admin/pickup/standing"
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl pt-2">
        <PageTop flush title="Staff · Pickup standing" fallbackHref={APP_HOME_URL} />
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-0">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
          <Link href="/admin/pickup" className="text-white/80 underline-offset-4 hover:text-white hover:underline">
            ← Pickup runs
          </Link>
          {waiverVersion ? (
            <span>
              Current waiver version: <span className="text-white/85">{waiverVersion}</span>
            </span>
          ) : null}
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-white/55">
          Effective standing is manual override when set; otherwise automatic rules apply from no-shows (90d),
          late cancellations, failed pickup payments, and waiver status. Players with suspended or banned
          effective standing cannot RSVP or pay for pickup.
        </p>

        {msg ? <p className="text-sm text-white/60">{msg}</p> : null}

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <label className="flex flex-col gap-1 text-xs text-white/55">
            Filter
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
            >
              <option value="all">All approved</option>
              <option value="good">Good + waiver (join-ready)</option>
              <option value="warning">Warning</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
              <option value="missing_waiver">Missing waiver</option>
            </select>
          </label>
          <label className="flex min-w-[220px] flex-col gap-1 text-xs text-white/55">
            Reliability
            <select
              value={reliabilityFilter}
              onChange={(e) => setReliabilityFilter(e.target.value)}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
            >
              <option value="all">All</option>
              <option value="good">Good Standing</option>
              <option value="building">Building rating</option>
              <option value="below">Below standard</option>
            </select>
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-white/55">
            Search (name, IG, email)
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
              placeholder="Optional"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-wider text-white/45">
              <tr>
                <th className="px-3 py-3">Player</th>
                <th className="px-3 py-3">Effective</th>
                <th className="px-3 py-3">Automatic</th>
                <th className="px-3 py-3">Waiver</th>
                <th className="px-3 py-3">Join</th>
                <th className="px-3 py-3">Reliability</th>
                <th className="px-3 py-3">History</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-white/45">
                    No rows for this filter.
                  </td>
                </tr>
              ) : (
                displayedRows.map((row) => (
                  <tr key={row.user_id} className="text-white/85">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-white">
                        {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                      </div>
                      <div className="text-xs text-white/45">{row.instagram ? `@${row.instagram}` : row.user_id}</div>
                      {row.tier ? <div className="text-[11px] text-white/40">Tier {row.tier}</div> : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chipTone(row.effective_standing)}`}
                      >
                        {row.effective_standing}
                      </span>
                      {row.manual_override ? (
                        <div className="mt-1 text-[11px] text-white/45">Manual override active</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-white/60">
                      <div>{row.auto_standing}</div>
                      {row.standing?.auto_codes?.length ? (
                        <ul className="mt-1 list-inside list-disc text-[11px] text-white/45">
                          {row.standing.auto_codes.map((c) => (
                            <li key={c}>{pickupAutoCodeLabel(c)}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top text-xs">
                      {row.waiver_current ? (
                        <span className="text-emerald-200/90">On file</span>
                      ) : (
                        <span className="text-amber-200/90">Missing</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-xs">
                      {row.join_ok ? (
                        <span className="text-emerald-200/90">Yes</span>
                      ) : (
                        <span className="text-red-200/85">No</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top font-mono text-[11px] text-white/55">
                      <div className="text-xs text-white/80">
                        {reliabilityLabel(row)}
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">
                        Tracked pickups: {row.reliability_tracked_pickups ?? 0}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top font-mono text-[11px] text-white/55">
                      NS {row.standing?.rollup_no_shows_90d ?? 0} · LC{" "}
                      {row.standing?.rollup_late_cancels_90d ?? 0} · Pay{" "}
                      {row.standing?.rollup_pickup_payment_issues_90d ?? 0}
                      <div className="mt-1">
                        Attended {row.attended_count ?? 0} / {row.confirmed_count ?? 0} · strikes{" "}
                        {row.strike_count ?? 0}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-white/85"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {edit ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="standing-edit-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/15 bg-neutral-950 p-5 shadow-xl">
            <h2 id="standing-edit-title" className="text-lg font-semibold text-white">
              Standing · {[edit.first_name, edit.last_name].filter(Boolean).join(" ") || edit.user_id}
            </h2>
            <p className="mt-2 text-xs text-white/45">
              Automatic: {edit.auto_standing}. Effective now: {edit.effective_standing}.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex flex-col gap-1 text-xs text-white/55">
                Manual override
                <select
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                >
                  <option value="">(none — use automatic only)</option>
                  <option value="good">good</option>
                  <option value="warning">warning</option>
                  <option value="suspended">suspended</option>
                  <option value="banned">banned</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/55">
                Reason (player-facing ops note)
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  placeholder="Why this override exists"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/55">
                Staff notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white"
                  placeholder="Internal context"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEdit(false)}
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEdit(true)}
                className="rounded-md border border-white/25 px-4 py-2 text-xs font-semibold text-white/85 disabled:opacity-50"
              >
                Clear override
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEdit(null)}
                className="rounded-md px-4 py-2 text-xs text-white/55"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
