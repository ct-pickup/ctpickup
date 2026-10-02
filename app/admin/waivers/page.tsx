"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
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
  if (parts.length) return parts.join("  ");
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
  const [search, setSearch] = useState("");

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = displayName(r).toLowerCase();
      return name.includes(q) || r.user_id.toLowerCase().includes(q) || r.version.toLowerCase().includes(q);
    });
  }, [rows, search]);

  if (!isReady || !sessionReady) {
    return (
      <main className="min-h-screen bg-canvas text-ink">
        <div className="mx-auto max-w-6xl pt-2 pb-8">
          <PageTop flush title="Staff · Waivers" fallbackHref={APP_HOME_URL} />
          <p className="mt-6 text-small text-muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-canvas text-ink">
        <div className="mx-auto max-w-6xl pt-2 pb-8">
          <PageTop flush title="Staff · Waivers" fallbackHref={APP_HOME_URL} />
          <p className="text-small text-muted">
            <a href="/login?next=/admin" className="underline-offset-4 hover:underline">
              Log in
            </a>{"  "}
            as an admin to view waiver acceptance records.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl space-y-6 py-8">
        <PageTop flush title="Staff · Waivers" fallbackHref={APP_HOME_URL} />

        <AdminWorkArea question="Who has accepted the current waiver version, and what blocks checkout or guidance until they do?">
          <p className="text-small text-muted">
            The active waiver version ships with the app — engineering bumps it when terms change. See also{"  "}
            <a href="/admin/settings" className="text-ink underline-offset-4 hover:underline">
              Settings
            </a>
            .
          </p>
        </AdminWorkArea>

        <input
          type="search"
          placeholder="Search by name, account ID, or waiver version…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-button border border-line bg-canvas px-3 py-2 text-small text-ink outline-none placeholder:text-muted"
        />

        <p className="text-small text-muted">
          Each line is one acceptance for a specific waiver version. When engineering bumps the version in code, players
          must accept again before tournament checkout or guidance requests.
        </p>

        {currentVersion ? (
          <p className="text-caption text-muted">
            Waiver version in the app:{"  "}
            <span className="font-semibold text-muted">{currentVersion}</span>
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void load()}
          className="text-small text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Refresh
        </button>

        {msg ? (
          <div className="rounded-button border border-line bg-card px-4 py-3 text-small text-ink">
            {msg}
          </div>
        ) : null}

        {loading ? (
          <p className="text-small text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-small text-muted">No acceptance records yet.</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-small text-muted">No matches for that search.</p>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((r) => (
              <div
                key={r.id}
                className="rounded-card border border-line bg-card p-5 md:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
                  <div>
                    <div className="text-caption text-muted">
                      {fmt(r.accepted_at)}
                    </div>
                    <div className="mt-1 font-semibold text-ink">{displayName(r)}</div>
                  </div>
                  <span className="rounded-pill border border-line bg-overlay-subtle px-2.5 py-1 text-caption font-medium text-ink">
                    {r.version}
                  </span>
                </div>
                <div className="mt-3 grid gap-1 text-small text-muted">
                  <div>
                    <span className="text-muted">User ID: </span>
                    <code className="text-caption text-muted">{r.user_id}</code>
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
