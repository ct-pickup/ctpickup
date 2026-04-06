"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import type { GuidancePlan, GuidanceRequestStatus } from "@/lib/guidanceRequest";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Row = {
  id: string;
  user_id: string;
  plan: GuidancePlan;
  message: string;
  status: GuidanceRequestStatus;
  created_at: string;
  submitter_name: string | null;
  submitter_email: string | null;
  profile_tier_snapshot: string | null;
  sport_focus: string | null;
};

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function AdminGuidancePage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setRows([]);
      return;
    }
    setMsg(null);
    setLoading(true);
    const { data, error } = await supabase
      .from("guidance_requests")
      .select(
        "id,user_id,plan,message,status,created_at,submitter_name,submitter_email,profile_tier_snapshot,sport_focus"
      )
      .order("created_at", { ascending: false });

    if (error) {
      setMsg(error.message);
      setRows([]);
    } else {
      setRows((data as Row[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!isReady) return;
    void load();
  }, [load, isReady]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [
        r.submitter_name,
        r.submitter_email,
        r.message,
        r.plan,
        r.sport_focus,
        r.profile_tier_snapshot,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  async function updateStatus(id: string, status: GuidanceRequestStatus) {
    if (!supabase) return;
    setMsg(null);
    const { error } = await supabase
      .from("guidance_requests")
      .update({ status })
      .eq("id", id);
    if (error) setMsg(error.message);
    else await load();
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-6 py-8">
        <PageTop flush title="Staff · Guidance inbox" fallbackHref={APP_HOME_URL} />

        <AdminWorkArea question="Which requests are still pending, and what should you mark assigned or completed next?">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {pendingCount > 0 ? <StatusChip tone="pending">{pendingCount} pending</StatusChip> : (
              <StatusChip tone="synced">Inbox clear</StatusChip>
            )}
            <Link href="/guidance" target="_blank" className="text-xs text-white/50 hover:text-white">
              Public page ↗
            </Link>
          </div>
          <input
            type="search"
            placeholder="Search name, email, plan, message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 w-full max-w-md rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
          />
        </AdminWorkArea>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/60">
            Table <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">guidance_requests</code> — tied to the public
            Guidance page only (not the site-wide status card).
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            Refresh
          </button>
        </div>

        {msg ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {msg}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-white/50">No requests yet.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-white/50">No matches for that search.</p>
        ) : (
          <div className="space-y-4">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/45">
                      {fmt(r.created_at)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold capitalize text-white">{r.plan}</span>
                      {r.status === "pending" ? (
                        <StatusChip tone="pending">Pending</StatusChip>
                      ) : r.status === "assigned" ? (
                        <StatusChip tone="scheduled">Assigned</StatusChip>
                      ) : (
                        <StatusChip tone="synced">Done</StatusChip>
                      )}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <span className="text-white/45">Status</span>
                    <select
                      value={r.status}
                      onChange={(e) =>
                        void updateStatus(
                          r.id,
                          e.target.value as GuidanceRequestStatus
                        )
                      }
                      className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-sm text-white outline-none"
                    >
                      <option value="pending">pending</option>
                      <option value="assigned">assigned</option>
                      <option value="completed">completed</option>
                    </select>
                  </label>
                </div>

                <div className="mt-3 grid gap-1 text-sm text-white/75">
                  <div>
                    <span className="text-white/45">From: </span>
                    {r.submitter_name || "—"}
                    {r.submitter_email ? (
                      <span className="text-white/55">
                        {" "}
                        · {r.submitter_email}
                      </span>
                    ) : null}
                  </div>
                  {r.profile_tier_snapshot ? (
                    <div>
                      <span className="text-white/45">Tier snapshot: </span>
                      {r.profile_tier_snapshot}
                    </div>
                  ) : null}
                  {r.sport_focus ? (
                    <div>
                      <span className="text-white/45">Sport / focus: </span>
                      {r.sport_focus}
                    </div>
                  ) : null}
                  <div>
                    <span className="text-white/45">User ID: </span>
                    <code className="text-xs text-white/60">{r.user_id}</code>
                  </div>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                  {r.message}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-white/40">
          Plans: foundation, development, elite. Use status for your internal
          workflow (pending → assigned → completed).
        </p>
      </div>
    </main>
  );
}
