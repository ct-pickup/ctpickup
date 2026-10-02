"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { PHOTO_REPORT_REASONS } from "@/shared/profilePhoto";

type Group = {
  user_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  reports: { id: string; reason: string | null; photo_url: string | null; created_at: string; reporter_name: string }[];
};

function reasonLabel(reason: string | null): string {
  return PHOTO_REPORT_REASONS.find((r) => r.value === reason)?.label ?? "No reason given";
}

export default function PhotoReportsClient() {
  const { supabase } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then((s) => setToken(s.data.session?.access_token || null));
  }, [supabase]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch("/api/admin/photo-reports", { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Couldn't load reports.");
        return;
      }
      setGroups((j.groups ?? []) as Group[]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(g: Group, action: "remove" | "dismiss") {
    if (!token || busy) return;
    if (action === "remove" && !window.confirm(`Remove ${g.name}'s photo? They'll be asked to add a new one.`)) return;
    setBusy(g.user_id);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/photo-reports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: g.user_id, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Couldn't save that. Try again.");
        return;
      }
      setGroups((cur) => cur.filter((x) => x.user_id !== g.user_id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminWorkArea question="Which reported profile photos need a decision?">
      <h1 className="mb-4 text-h2 font-semibold">Photo reports</h1>
      {msg ? <p className="mb-4 text-small text-coral-text">{msg}</p> : null}
      {loading ? <p className="text-small text-muted">Loading…</p> : null}
      {!loading && groups.length === 0 ? <p className="text-small text-muted">No open reports.</p> : null}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.user_id} className="flex gap-4 rounded-card border border-line bg-card p-4">
            {g.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.avatar_url} alt={`${g.name}'s photo`} className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-pitch-panel text-small text-muted">
                No photo
              </div>
            )}
            <div className="flex-1">
              <p className="font-semibold">
                {g.name}
                {g.username ? <span className="text-muted"> @{g.username}</span> : null}
              </p>
              <p className="text-small text-muted">
                {g.reports.length} open {g.reports.length === 1 ? "report" : "reports"}
              </p>
              <ul className="mt-2 text-small">
                {g.reports.map((r) => (
                  <li key={r.id}>
                    {reasonLabel(r.reason)} · {r.reporter_name} · {new Date(r.created_at).toLocaleDateString()}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy === g.user_id}
                  onClick={() => void review(g, "remove")}
                  className="rounded-full border border-coral px-4 py-2 text-small font-medium text-coral-text disabled:opacity-50"
                >
                  Remove photo
                </button>
                <button
                  type="button"
                  disabled={busy === g.user_id}
                  onClick={() => void review(g, "dismiss")}
                  className="rounded-full border border-line px-4 py-2 text-small font-medium disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </AdminWorkArea>
  );
}
