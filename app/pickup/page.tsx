"use client";

import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import {
  AuthenticatedProfileMenu,
  PageShell,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import {
  PROFILE_GOALIE_HEADCOUNT_TARGET,
  shouldWarnLowWillingGoalies,
} from "@/lib/pickup/profileGoalieRoster";
import { WaiverAcceptanceModal } from "@/components/waiver/WaiverAcceptanceModal";
import Link from "next/link";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useEffect, useMemo, useRef, useState } from "react";

type PendingPickup =
  | { kind: "availability"; state: "available" | "declined"; slot_id: string | null }
  | { kind: "rsvp"; action: "join" | "decline" }
  | { kind: "pay" };

type Data = any;

function pill(status: string) {
  if (status === "active") return "border-emerald-500/25 bg-emerald-500/15 text-emerald-200";
  if (status === "planning") return "border-white/15 bg-white/10 text-white/85";
  return "border-red-500/25 bg-red-500/15 text-red-200";
}

function fmt(dt: string | null) {
  if (!dt) return "TBD";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "TBD";
  }
}

export default function PickupPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const pendingPickup = useRef<PendingPickup | null>(null);

  async function waiverAcceptedNow(): Promise<boolean> {
    if (!token) return false;
    const r = await fetch("/api/waiver/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    return !!j?.accepted;
  }

  async function refresh(t = token) {
    setLoading(true);
    const headers: any = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    const r = await fetch("/api/pickup/public", { headers });
    setData(await r.json());
    setLoading(false);
  }

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token ?? null);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const runTypeLabel = useMemo(() => {
    const rt = data?.run?.run_type;
    if (!rt) return "";
    return rt === "select" ? "SELECT PICKUP" : "PUBLIC PICKUP";
  }, [data]);

  const statusLabel = useMemo(() => {
    const st = data?.run?.status;
    if (!st) return "NO RUN ANNOUNCED";
    if (st === "planning") return "PLANNING";
    if (st === "likely_on") return "LIKELY ON";
    if (st === "active") return "CONFIRMED / ACTIVE";
    return st.toUpperCase();
  }, [data]);

  async function submitAvailability(state: "available" | "declined", slot_id?: string | null) {
    if (!token || !data?.run?.id) return;

    const sid = slot_id ?? null;
    if (!(await waiverAcceptedNow())) {
      pendingPickup.current = { kind: "availability", state, slot_id: sid };
      setWaiverModalOpen(true);
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pickup/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: data.run.id,
          slot_id: sid,
          state,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403 && j?.error === "waiver_required") {
          pendingPickup.current = { kind: "availability", state, slot_id: sid };
          setWaiverModalOpen(true);
          setMsg(null);
          return;
        }
        setMsg(j?.error || "Could not submit availability.");
        return;
      }
      await refresh(token);
    } finally {
      setBusy(false);
    }
  }

  async function rsvp(action: "join" | "decline") {
    if (!token || !data?.run?.id) return;

    if (!(await waiverAcceptedNow())) {
      pendingPickup.current = { kind: "rsvp", action };
      setWaiverModalOpen(true);
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pickup/rsvp", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, run_id: data.run.id }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403 && j?.error === "waiver_required") {
          pendingPickup.current = { kind: "rsvp", action };
          setWaiverModalOpen(true);
          setMsg(null);
          return;
        }
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

  async function payNow() {
    if (!token || !data?.run?.id) return;

    if (!(await waiverAcceptedNow())) {
      pendingPickup.current = { kind: "pay" };
      setWaiverModalOpen(true);
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pickup/pay", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: data.run.id }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403 && j?.error === "waiver_required") {
          pendingPickup.current = { kind: "pay" };
          setWaiverModalOpen(true);
          setMsg(null);
          return;
        }
        setMsg(j?.error || "Could not start checkout.");
        return;
      }
      window.location.href = j.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell maxWidthClass="max-w-5xl" className="pb-16 pt-2">
      <TopNav
        brandHref={APP_HOME_URL}
        homeHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <EsportsSetupNudgeBar />

      <div className="space-y-8 pb-6 pt-2 md:pt-4">
        <section className="rounded-2xl border border-white/15 bg-white/5 p-7 space-y-5">
          <div className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold border ${pill(data?.status || "inactive")}`}>
            {runTypeLabel ? `${runTypeLabel} · ${statusLabel}` : statusLabel}
          </div>

          {!token ? (
            <div className="space-y-3">
              <div className="text-white/80">Log in to see your invite status and respond.</div>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
              >
                LOG IN
              </Link>
            </div>
          ) : loading ? (
            <div className="text-white/70">Loading…</div>
          ) : !data?.run ? (
            <EmptyStateMessage>No active pickup games</EmptyStateMessage>
          ) : !data?.me?.approved ? (
            <div className="text-white/80">
              Your account is pending approval. If you’re already known to CT Pickup, we’ll approve your account and tier.
            </div>
          ) : (
            <>
              {(data.globalUpdate || data.runUpdate) ? (
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 space-y-4">
                  {data.globalUpdate ? (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-widest text-white/55">Global update</div>
                      <div className="text-sm text-white/85 whitespace-pre-line">{data.globalUpdate.message}</div>
                    </div>
                  ) : null}

                  {data.runUpdate ? (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-widest text-white/55">Run update</div>
                      <div className="text-sm text-white/85 whitespace-pre-line">{data.runUpdate.message}</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyStateMessage>No updates posted yet.</EmptyStateMessage>
              )}

              <div className="space-y-1 pt-2">
                <div className="text-white/90 text-lg font-semibold">{data.run.title}</div>
                <div className="text-sm text-white/70">{fmt(data.run.start_at)}</div>
              </div>

              {!data.visibility?.invitedNow && (data.run.status === "planning" || data.run.status === "likely_on") ? (
                <div className="text-sm text-white/60">
                  {data.run.open_tier_rank == null
                    ? "Invites have not opened yet."
                    : "You’re not invited yet for this planning poll."}
                </div>
              ) : null}

              {(data.run.status === "planning" || data.run.status === "likely_on") && !data.run.final_slot_id ? (
                <div className="space-y-4 pt-2">
                  <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                    Availability poll (choose one)
                  </div>

                  <div className="grid gap-3">
                    {data.planning?.slotCounts?.length ? (
                      data.planning.slotCounts.map((s: any) => {
                        const picked = data.planning?.my_availability?.slot_id === s.slot_id && data.planning?.my_availability?.state === "available";
                        return (
                          <button
                            key={s.slot_id}
                            type="button"
                            disabled={busy || !data.visibility?.invitedNow}
                            onClick={() => submitAvailability("available", s.slot_id)}
                            className={[
                              "w-full text-left rounded-xl border p-4",
                              picked
                                ? "border-white/25 bg-white/[0.06]"
                                : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
                              busy || !data.visibility?.invitedNow ? "opacity-60" : "",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="text-sm font-semibold text-white/90">
                                {fmt(s.start_at)}
                              </div>
                              <div className="text-xs text-white/55">
                                Tier-1: {s.tier1_count} · Total: {s.total_available}
                              </div>
                            </div>
                            {s.label ? <div className="text-xs text-white/55 mt-1">{s.label}</div> : null}
                          </button>
                        );
                      })
                    ) : (
                      <EmptyStateMessage>No time slots posted yet.</EmptyStateMessage>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      type="button"
                      disabled={busy || !data.visibility?.invitedNow}
                      onClick={() => submitAvailability("declined", null)}
                      className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
                    >
                      Decline
                    </button>

                    {data.run.status === "likely_on" ? (
                      <div className="text-sm text-white/60 flex items-center">
                        Likely On triggered (Tier-1 ≥ 5 on a slot). Admin will finalize the time.
                      </div>
                    ) : (
                      <div className="text-sm text-white/60 flex items-center">
                        Likely On triggers when 5 Tier-1 players pick the same slot.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {data.run.status === "active" && data.run.final_slot_id ? (
                <div className="space-y-4 pt-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Confirmed</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.final?.counts?.confirmed ?? 0}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Standby</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.final?.counts?.standby ?? 0}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                      <div className="text-xs uppercase tracking-widest text-white/55">Pending payment</div>
                      <div className="mt-2 text-2xl font-semibold text-white/90">{data.final?.counts?.pending_payment ?? 0}</div>
                    </div>
                  </div>

                  {!data.final?.eligible ? (
                    <div className="text-sm text-white/60">
                      You’re not eligible for final RSVP (you must have selected the finalized slot in the planning poll).
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {data.final?.my_status === "confirmed" ? (
                        <>
                          <div className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200">
                            Confirmed
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rsvp("decline")}
                            className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : data.final?.my_status === "standby" ? (
                        <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/85">
                          Standby (admin promotes manually)
                        </div>
                      ) : data.final?.my_status === "pending_payment" ? (
                        <div className="flex flex-wrap gap-3 items-center">
                          <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/85">
                            Payment required to confirm
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={payNow}
                            className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                          >
                            Pay now
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rsvp("join")}
                            className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                          >
                            {data.run.fee_cents > 0 ? "Pay & confirm" : "Confirm spot"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rsvp("decline")}
                            className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04] disabled:opacity-50"
                          >
                            Not now
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {data.run.cancellation_deadline ? (
                    <div className="text-sm text-white/70">
                      Cancellation deadline: {fmt(data.run.cancellation_deadline)}
                    </div>
                  ) : null}

                  <div className="text-sm text-white/75">
                    <span className="font-semibold text-white/85">Important:</span>{" "}
                    Standby never receives the exact location. Only confirmed players do.
                  </div>

                  {data.visibility?.attendanceVisible ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
                      <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                        Attendance (visible to invited tiers)
                      </div>
                      {data.attendees?.length ? (
                        <div className="space-y-1 text-sm text-white/75">
                          {data.attendees.map((a: any, idx: number) => (
                            <div key={idx}>
                              {a.full_name || "Player"}{" "}
                              {a.instagram ? <span className="text-white/55">(@{a.instagram})</span> : null}
                              {a.plays_goalie ? (
                                <span className="text-emerald-200/80"> · goalie</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyStateMessage>No confirmed players shown yet.</EmptyStateMessage>
                      )}
                      {typeof data.counts?.goalie_willing_confirmed === "number" &&
                      typeof data.counts?.confirmed === "number" &&
                      shouldWarnLowWillingGoalies(
                        data.counts.confirmed,
                        data.counts.goalie_willing_confirmed,
                      ) ? (
                        <div
                          className="mt-3 rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-3 py-2.5 text-xs leading-relaxed text-amber-50/95"
                          role="status"
                        >
                          <span className="font-semibold text-amber-100">Heads up — goalies:</span> Only{" "}
                          {data.counts.goalie_willing_confirmed} confirmed
                          {data.counts.goalie_willing_confirmed === 1 ? " player" : " players"} listed
                          themselves as willing to play goalie in Profile. Most pickup games need at least{" "}
                          {PROFILE_GOALIE_HEADCOUNT_TARGET}. This is informational only — staff will still
                          balance the session.
                        </div>
                      ) : typeof data.counts?.goalie_willing_confirmed === "number" &&
                        data.counts.confirmed > 0 &&
                        !shouldWarnLowWillingGoalies(
                          data.counts.confirmed,
                          data.counts.goalie_willing_confirmed,
                        ) ? (
                        <p className="pt-3 text-xs text-white/55 leading-relaxed">
                          {data.counts.goalie_willing_confirmed} confirmed
                          {data.counts.goalie_willing_confirmed === 1 ? " player" : " players"} said in
                          Profile they can play goalie (target: at least {PROFILE_GOALIE_HEADCOUNT_TARGET}{" "}
                          for most sessions).
                        </p>
                      ) : null}
                      {token && data.me?.plays_goalie == null ? (
                        <p className="pt-2 text-xs text-white/50 leading-relaxed">
                          <Link href="/profile" className="font-medium text-white/75 underline-offset-4 hover:underline">
                            Add whether you play goalie in your profile
                          </Link>{" "}
                          so we can balance skaters and goalies.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {data.location ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
                      <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Location</div>
                      <div className="text-sm text-white/75 whitespace-pre-line">{data.location}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {msg ? <div className="text-sm text-red-200 pt-2">{msg}</div> : null}
            </>
          )}
        </section>
      </div>

      {waiverModalOpen && token ? (
        <WaiverAcceptanceModal
          token={token}
          onClose={() => {
            setWaiverModalOpen(false);
            pendingPickup.current = null;
          }}
          onAccepted={() => {
            setWaiverModalOpen(false);
            const p = pendingPickup.current;
            pendingPickup.current = null;
            if (!p) return;
            if (p.kind === "availability") void submitAvailability(p.state, p.slot_id);
            else if (p.kind === "rsvp") void rsvp(p.action);
            else void payNow();
          }}
        />
      ) : null}
    </PageShell>
  );
}
