"use client";

import PageTop from "@/components/PageTop";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Data = any;

function pill(status: string) {
  if (status === "active") return "border-emerald-500/25 bg-emerald-500/15 text-emerald-200";
  if (status === "planning") return "border-white/15 bg-white/10 text-white/85";
  return "border-red-500/25 bg-red-500/15 text-red-200";
}

export default function PickupPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh(t = token) {
    setLoading(true);
    const headers: any = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    const r = await fetch("/api/pickup/public", { headers });
    setData(await r.json());
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const s = await supabase.auth.getSession();
      setToken(s.data.session?.access_token || null);
    })();
  }, []);

  useEffect(() => {
    refresh();
  }, [token]);

  async function act(action: "join" | "decline") {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pickup/rsvp", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j?.error || "Something went wrong.");
        return;
      }
      if (j.checkout_url) {
        window.location.href = j.checkout_url;
        return;
      }
      await refresh(token);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = useMemo(() => {
    if (!data) return "";
    if (data.status === "active") return "CONFIRMED / ACTIVE";
    if (data.status === "planning") return "PLANNING";
    return "NO RUN ANNOUNCED";
  }, [data]);

  const runTypeLabel = useMemo(() => {
    if (!data?.run) return "";
    return data.run.run_type === "select" ? "SELECT PICKUP" : "PUBLIC PICKUP";
  }, [data]);

  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="PICKUP" />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 space-y-4">
          <div className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold border ${pill(data?.status || "inactive")}`}>
            {runTypeLabel ? `${runTypeLabel} · ${statusLabel}` : statusLabel}
          </div>

          {!token ? (
            <div className="space-y-3">
              <div className="text-white/80">Log in to see your invite status and RSVP.</div>
              <Link href="/login" className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto">
                LOG IN
              </Link>
            </div>
          ) : loading ? (
            <div className="text-white/70">Loading…</div>
          ) : !data?.run ? (
            <div className="text-white/80">No run announced.</div>
          ) : (
            <>
              {!data.me?.approved ? (
                <div className="text-white/80">
                  Your account is pending approval. If you’re already known to CT Pickup, we’ll approve your account and tier.
                </div>
              ) : (
                <>
                  <div className="text-white/90 text-lg font-semibold">{data.run.title}</div>
                  <div className="text-sm text-white/70">{new Date(data.run.start_at).toLocaleString()}</div>

                  <div className="grid gap-3 sm:grid-cols-3 pt-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Confirmed</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.counts.confirmed}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Standby</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.counts.standby}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Tier-1 confirmed</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.counts.tier1Confirmed}</div>
                      <div className="mt-2 text-xs text-white/55">Run becomes active at 5 Tier-1 confirmed.</div>
                    </div>
                  </div>

                  <div className="text-sm text-white/75">
                    <span className="font-semibold text-white/85">Important:</span>{" "}
                    Standby never receives the exact location. Only confirmed players do.
                  </div>

                  {data.run.cancellation_deadline ? (
                    <div className="text-sm text-white/70">
                      Cancellation deadline:{" "}
                      {new Date(data.run.cancellation_deadline).toLocaleString()}
                    </div>
                  ) : null}

                  {!data.visibility?.invitedNow ? (
                    <div className="text-sm text-white/60">
                      You’re not invited yet. Attendance is hidden until your tier is invited.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3 pt-2">
                      {data.my_status === "confirmed" ? (
                        <>
                          <div className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200">
                            Confirmed
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("decline")}
                            className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : data.my_status === "standby" ? (
                        <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/85">
                          Standby (admin promotes manually)
                        </div>
                      ) : data.my_status === "pending_payment" ? (
                        <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/85">
                          Payment pending
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("join")}
                            className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                          >
                            {data.run.fee_cents > 0 ? "Pay & confirm" : "Confirm spot"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("decline")}
                            className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
                          >
                            Not now
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {msg ? <div className="text-sm text-red-200 pt-2">{msg}</div> : null}

                  {data.visibility?.attendanceVisible ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2 mt-5">
                      <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                        Attendance (visible to invited tiers)
                      </div>
                      {data.attendees?.length ? (
                        <div className="space-y-1 text-sm text-white/75">
                          {data.attendees.map((a: any, idx: number) => (
                            <div key={idx}>
                              {a.full_name || "Player"}{" "}
                              {a.instagram ? <span className="text-white/55">(@{a.instagram})</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-white/60">No confirmed players shown yet.</div>
                      )}
                    </div>
                  ) : null}

                  {data.my_status === "confirmed" && data.run.location_text ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2 mt-5">
                      <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Location</div>
                      <div className="text-sm text-white/75 whitespace-pre-line">{data.run.location_text}</div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
