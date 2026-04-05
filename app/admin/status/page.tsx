"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageTop from "@/components/PageTop";
import { AdminHubNav } from "@/components/admin/AdminHubNav";
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
      setMsg(
        "Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
      );
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

  if (!row) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-xl space-y-4 px-6 pt-2 pb-8">
          <PageTop flush title="ADMIN · STATUS" fallbackHref={APP_HOME_URL} />
          <AdminHubNav />
          <p className="text-sm text-white/55">{msg ?? "Loading…"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-xl space-y-6 px-6 pt-2 pb-8">
        <PageTop flush title="ADMIN · STATUS" fallbackHref={APP_HOME_URL} />
        <AdminHubNav />

        <div className="space-y-3">
          <label className="block">
            <div className="text-sm text-white/55">Phase</div>
            <input
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white outline-none"
              value={row.phase}
              onChange={(e) => setRow({ ...row, phase: e.target.value })}
            />
          </label>

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
