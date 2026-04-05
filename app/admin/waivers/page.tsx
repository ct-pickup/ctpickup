"use client";

import { useCallback, useEffect, useState } from "react";
import PageTop from "@/components/PageTop";
import { AdminHubNav } from "@/components/admin/AdminHubNav";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Row = {
  id: string;
  user_id: string;
  version: string;
  accepted_at: string;
  profile: {
    first_name: string | null;
    last_name: string | null;
    instagram: string | null;
  } | null;
};

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function displayName(r: Row) {
  const p = r.profile;
  const parts = [p?.first_name, p?.last_name].filter(Boolean).map(String);
  if (parts.length) return parts.join(" ");
  if (p?.instagram) return `@${String(p.instagram).replace(/^@/, "")}`;
  return "—";
}

export default function AdminWaiversPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    if (!supabase) {
      setSessionReady(true);
      return;
    }
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token ?? null);
      setSessionReady(true);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  const load = useCallback(async () => {
    if (!token) {
      setRows([]);
      setCurrentVersion(null);
      setLoading(false);
      return;
    }
    setMsg(null);
    setLoading(true);
    const r = await fetch("/api/admin/waiver-acceptances", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(typeof j?.error === "string" ? j.error : "Could not load records.");
      setRows([]);
    } else {
      setCurrentVersion(j.currentWaiverVersion ?? null);
      setRows(Array.isArray(j.rows) ? j.rows : []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isReady || !sessionReady) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 pt-2 pb-8">
          <PageTop flush title="ADMIN · WAIVERS" fallbackHref={APP_HOME_URL} />
          <p className="mt-6 text-sm text-white/50">Loading…</p>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 pt-2 pb-8">
          <PageTop flush title="ADMIN · WAIVERS" fallbackHref={APP_HOME_URL} />
          <AdminHubNav className="pb-4" />
          <p className="text-sm text-white/60">
            <a href="/login?next=/admin/waivers" className="underline-offset-4 hover:underline">
              Log in
            </a>{" "}
            as an admin to view waiver acceptance records.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <PageTop flush title="ADMIN · WAIVERS" fallbackHref={APP_HOME_URL} />
        <AdminHubNav />

        <p className="text-sm text-white/60">
          Records are stored in Supabase table{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
            user_waiver_acceptance
          </code>
          . Each row is one acceptance for a specific waiver version; when you bump the
          version in code, users must accept again before tournament checkout or guidance
          requests.
        </p>

        {currentVersion ? (
          <p className="text-xs uppercase tracking-widest text-white/45">
            Active app waiver version:{" "}
            <span className="font-semibold text-white/70">{currentVersion}</span>
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void load()}
          className="text-sm text-white/55 underline-offset-4 hover:text-white hover:underline"
        >
          Refresh
        </button>

        {msg ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {msg}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-white/50">No acceptance records yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/45">
                      {fmt(r.accepted_at)}
                    </div>
                    <div className="mt-1 font-semibold text-white">{displayName(r)}</div>
                  </div>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80">
                    {r.version}
                  </span>
                </div>
                <div className="mt-3 grid gap-1 text-sm text-white/70">
                  <div>
                    <span className="text-white/45">User ID: </span>
                    <code className="text-xs text-white/60">{r.user_id}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
