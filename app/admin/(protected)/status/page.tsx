"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type StatusRow = {
  id: number;
  phase: string;
  primary_slot: string | null;
  secondary_slot: string | null;
  next_update_by: string | null;
  announcement: string | null;
};

export default function AdminStatusPage() {
  const supabase = supabaseBrowser();
  const [row, setRow] = useState<StatusRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("status_updates")
        .select("id,phase,primary_slot,secondary_slot,next_update_by,announcement")
        .eq("id", 1)
        .single();

      if (error) setMsg(error.message);
      else setRow(data as StatusRow);
    })();
  }, [supabase]);

  async function save() {
    setMsg(null);
    if (!row) return;

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
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold">Edit Status</h1>
        <p className="mt-4">{msg ?? "Loading..."}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold">Edit Status</h1>

      <div className="mt-6 space-y-3">
        <label className="block">
          <div className="text-sm text-gray-600">Phase</div>
          <input
            className="w-full rounded-lg border p-3"
            value={row.phase}
            onChange={(e) => setRow({ ...row, phase: e.target.value })}
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Primary slot</div>
          <input
            className="w-full rounded-lg border p-3"
            value={row.primary_slot ?? ""}
            onChange={(e) =>
              setRow({ ...row, primary_slot: e.target.value || null })
            }
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Secondary slot</div>
          <input
            className="w-full rounded-lg border p-3"
            value={row.secondary_slot ?? ""}
            onChange={(e) =>
              setRow({ ...row, secondary_slot: e.target.value || null })
            }
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Next update by (ISO)</div>
          <input
            className="w-full rounded-lg border p-3"
            placeholder="2026-03-02T18:00:00Z"
            value={row.next_update_by ?? ""}
            onChange={(e) =>
              setRow({ ...row, next_update_by: e.target.value || null })
            }
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Announcement</div>
          <textarea
            className="w-full rounded-lg border p-3 min-h-[140px]"
            value={row.announcement ?? ""}
            onChange={(e) =>
              setRow({ ...row, announcement: e.target.value || null })
            }
          />
        </label>

        <button className="rounded-lg border px-4 py-3 font-medium" onClick={save}>
          Save
        </button>

        {msg ? <p className="text-sm text-gray-700">{msg}</p> : null}
      </div>
    </main>
  );
}