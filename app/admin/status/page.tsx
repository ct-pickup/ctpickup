"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StatusChip } from "@/components/admin/StatusChip";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { APP_HOME_URL } from "@/lib/siteNav";

type StatusRow = {
  id: number;
  phase: string;
  primary_slot: string | null;
  secondary_slot: string | null;
  next_update_by: string | null;
  announcement: string | null;
};

export default function AdminStatusPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const [row, setRow] = useState<StatusRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabaseRef.current = supabase;
  }, [supabase]);

  useEffect(() => {
    if (!isReady) return;
    if (!supabase) {
      setMsg("Database isn’t configured — check your environment for the public database URL and anon key.");
      return;
    }

    const client = supabase;
    (async () => {
      const { data, error } = await client
        .from("status_updates")
        .select("id,phase,primary_slot,secondary_slot,next_update_by,announcement")
        .eq("id", 1)
        .single();

      if (error) setMsg(error.message);
      else setRow(data as StatusRow);
    })();
  }, [supabase, isReady]);

  async function save() {
    const supabase = supabaseRef.current;
    setMsg(null);
    if (!supabase || !row) return;

    const { error } = await supabase
      .from("status_updates")
      .update({
        phase: row.phase,
        primary_slot: row.primary_slot,
        secondary_slot: row.secondary_slot,
        next_update_by: row.next_update_by,
        announcement: row.announcement,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    setMsg(error ? error.message : "Saved.");
  }

  const chips = useMemo(() => {
    if (!row) return null;
    const ann = (row.announcement || "").trim();
    const nu = row.next_update_by ? new Date(row.next_update_by).getTime() : NaN;
    const scheduled = !Number.isNaN(nu) && nu > Date.now();
    return (
      <div className="mb-4 flex flex-wrap gap-2">
        {!ann ? <StatusChip tone="draft">Draft</StatusChip> : <StatusChip tone="published">Live copy</StatusChip>}
        {scheduled ? <StatusChip tone="scheduled">Commitment</StatusChip> : null}
        <StatusChip tone="synced">Save = public on next load</StatusChip>
      </div>
    );
  }, [row]);

  if (!row) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-xl space-y-4 pt-2 pb-8">
          <PageTop flush title="Staff · Site-wide status" fallbackHref={APP_HOME_URL} />
          <p className="text-sm text-white/55">{msg ?? "Loading…"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-xl space-y-6 pt-2 pb-8">
        <PageTop flush title="Staff · Site-wide status" fallbackHref={APP_HOME_URL} />

        <AdminWorkArea question="What should visitors read on status pages right now, and when did you promise the next update?">
          {chips}
          <div className="mb-6 flex flex-wrap gap-3 text-xs">
            <Link href="/status/pickup" target="_blank" className="text-white/55 hover:text-white">
              Preview pickup status ↗
            </Link>
            <Link href="/status/tournament" target="_blank" className="text-white/55 hover:text-white">
              Preview tournament status ↗
            </Link>
            <Link href="/admin/content" className="text-white/55 hover:text-white">
              Content workflow
            </Link>
          </div>
        </AdminWorkArea>

        <div className="space-y-3">
          <label className="block">
            <div className="text-sm text-white/55">Phase</div>
            <input
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
              value={row.phase}
              onChange={(e) => setRow({ ...row, phase: e.target.value })}
            />
          </label>

          <details className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <summary className="cursor-pointer text-sm text-white/70">Slot lines &amp; schedule (advanced)</summary>
            <div className="mt-3 space-y-3">
              <label className="block">
                <div className="text-sm text-white/55">Primary slot</div>
                <input
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
                  value={row.primary_slot ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, primary_slot: e.target.value || null })
                  }
                />
              </label>

              <label className="block">
                <div className="text-sm text-white/55">Secondary slot</div>
                <input
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
                  value={row.secondary_slot ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, secondary_slot: e.target.value || null })
                  }
                />
              </label>

              <label className="block">
                <div className="text-sm text-white/55">Next update by (ISO)</div>
                <input
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
                  placeholder="2026-03-02T18:00:00Z"
                  value={row.next_update_by ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, next_update_by: e.target.value || null })
                  }
                />
              </label>
            </div>
          </details>

          <label className="block">
            <div className="text-sm text-white/55">Announcement</div>
            <textarea
              className="min-h-[140px] w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
              value={row.announcement ?? ""}
              onChange={(e) =>
                setRow({ ...row, announcement: e.target.value || null })
              }
            />
          </label>

          <button
            type="button"
            className="rounded-lg border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
            onClick={save}
          >
            Save
          </button>

          {msg ? <p className="text-sm text-white/70">{msg}</p> : null}
        </div>
      </div>
    </main>
  );
}
