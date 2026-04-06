"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import { WaiverAcceptanceModal } from "@/components/waiver/WaiverAcceptanceModal";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Prelim = {
  fullName: string;
  instagram: string;
};

type TournamentPublic = {
  tournament: {
    id: string;
    slug: string;
    title: string;
    targetTeams: number;
    officialThreshold: number;
    maxTeams: number;
  } | null;
  claimedTeams: number;
  confirmedTeams: number;
  official: boolean;
  full: boolean;
  error?: string;
};

function statusHeadline(d: TournamentPublic | null) {
  if (!d?.tournament) return "Not scheduled";
  if (d.full) return "Full";
  if (d.official) return "Confirmed";
  return "Planning";
}

function statusBlurb(d: TournamentPublic | null) {
  if (!d?.tournament) {
    return "There is no active tournament right now. Check back soon.";
  }
  if (d.full) {
    return "This tournament has reached the maximum number of confirmed teams.";
  }
  if (d.official) {
    return "The tournament is confirmed. Team spots may still be open until the field is full.";
  }
  return "The tournament becomes confirmed once the minimum team threshold is reached.";
}

export default function TournamentPage() {
  const { supabase, isReady } = useSupabaseBrowser();

  const [publicData, setPublicData] = useState<TournamentPublic | null>(null);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<"rules" | "form">("rules");
  const [rulesRead, setRulesRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [captainName, setCaptainName] = useState("");
  const [captainIg, setCaptainIg] = useState("");
  const [teamName, setTeamName] = useState("");
  const [expectedPlayers, setExpectedPlayers] = useState(10);
  const [prelimRoster, setPrelimRoster] = useState<Prelim[]>([]);

  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [checkingWaiver, setCheckingWaiver] = useState(false);
  const [waiverGateMessage, setWaiverGateMessage] = useState<string | null>(null);

  const refreshPublic = useCallback(async () => {
    setPublicLoading(true);
    setPublicError(null);
    try {
      const r = await fetch("/api/tournament/public", { cache: "no-store" });
      const j = (await r.json()) as TournamentPublic & { error?: string };
      if (!r.ok) {
        setPublicData(null);
        setPublicError(j?.error || "Could not load tournament.");
        return;
      }
      setPublicData(j);
    } catch {
      setPublicData(null);
      setPublicError("Could not load tournament.");
    } finally {
      setPublicLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPublic();
  }, [refreshPublic]);

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const s = await supabase.auth.getSession();
      setToken(s.data.session?.access_token ?? null);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  useEffect(() => {
    if (!modalOpen) {
      setStep("rules");
      setRulesRead(false);
      setAgreed(false);
      setTypedName("");
    }
  }, [modalOpen]);

  const t = publicData?.tournament ?? null;
  const claimsClosed =
    !!t && (publicData?.claimedTeams ?? 0) >= t.targetTeams;
  const claimDisabled =
    publicLoading || !t || claimsClosed || !!publicData?.full;

  function openClaimModalInner() {
    setError(null);
    setClaimDone(false);
    setStep("rules");
    setRulesRead(false);
    setAgreed(false);
    setTypedName(captainName || "");
    setModalOpen(true);
  }

  async function openClaimModal() {
    setWaiverGateMessage(null);
    setError(null);
    setClaimDone(false);
    if (!token) {
      setWaiverGateMessage("Please log in to claim a team.");
      return;
    }
    setCheckingWaiver(true);
    try {
      const r = await fetch("/api/waiver/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.accepted) {
        setWaiverModalOpen(true);
        return;
      }
      openClaimModalInner();
    } catch {
      setWaiverGateMessage("Could not verify waiver status. Try again.");
    } finally {
      setCheckingWaiver(false);
    }
  }

  async function submitAgreement() {
    const fullName = typedName.trim();
    if (!rulesRead || !agreed || !fullName) return;

    setError(null);

    const res = await fetch("/api/tournament/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: fullName,
        signed_name: fullName,
        page: "/tournament",
        consent_version: "tournament_rules_v1",
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "Could not record consent. Please try again.");
      return;
    }

    setCaptainName(fullName);
    setStep("form");
  }

  function addPrelimRow() {
    setPrelimRoster((rows) => [...rows, { fullName: "", instagram: "" }]);
  }

  function removePrelim(i: number) {
    setPrelimRoster((rows) => rows.filter((_, idx) => idx !== i));
  }

  function updatePrelim(i: number, key: keyof Prelim, value: string) {
    setPrelimRoster((rows) =>
      rows.map((row, idx) => (idx === i ? { ...row, [key]: value } : row))
    );
  }

  async function submitClaim() {
    if (!token) {
      setError("Please log in to claim a team.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/tournament/captain/submit-claim", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          captainName: captainName.trim(),
          captainInstagram: captainIg.trim(),
          teamName: teamName.trim(),
          expectedPlayers,
          prelimRoster: prelimRoster.map((p) => ({
            fullName: p.fullName,
            instagram: p.instagram,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data?.error === "waiver_required") {
          setModalOpen(false);
          setWaiverModalOpen(true);
          return;
        }
        setError(
          typeof data?.error === "string"
            ? data.error.replace(/_/g, " ")
            : "Could not submit claim. Please try again."
        );
        return;
      }
      setClaimDone(true);
      await refreshPublic();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function goToPayment() {
    if (!token) {
      setError("Please log in to continue to payment.");
      return;
    }
    setPayBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403 && j?.error === "waiver_required") {
          setModalOpen(false);
          setWaiverModalOpen(true);
          return;
        }
        setError(
          typeof j?.error === "string"
            ? j.error.replace(/_/g, " ")
            : "Could not start checkout."
        );
        return;
      }
      if (j?.url) {
        window.location.href = j.url;
      }
    } catch {
      setError("Could not start checkout.");
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <PageShell className="pb-16 pt-2">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <EsportsSetupNudgeBar />

      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <div className="space-y-10">
          <div className="space-y-3">
            <SectionEyebrow>Tournament Status</SectionEyebrow>
            {publicLoading ? (
              <div className="text-2xl font-semibold text-white/60 md:text-3xl">Loading…</div>
            ) : publicError ? (
              <>
                <div className="text-2xl font-semibold text-white md:text-3xl">Unavailable</div>
                <p className="text-sm text-white/55">{publicError}</p>
              </>
            ) : (
              <>
                <div className="text-4xl font-semibold text-white md:text-5xl">
                  {statusHeadline(publicData)}
                </div>
                {!t ? (
                  <EmptyStateMessage className="mt-2">
                    No tournaments available
                  </EmptyStateMessage>
                ) : (
                  <p className="text-sm text-white/55">{statusBlurb(publicData)}</p>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
              Captain-Based Entry
            </h2>
            <p className="text-sm leading-7 text-white/70">
              Captains claim a team slot first. Final approval depends on payment,
              roster verification, eligibility review, and admin approval.
            </p>

            <button
              type="button"
              onClick={() => void openClaimModal()}
              disabled={claimDisabled || !!publicError || checkingWaiver}
              className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checkingWaiver ? "Checking…" : "CLAIM A TEAM"}
            </button>
            {waiverGateMessage ? (
              <p className="text-xs font-medium text-red-300/95">{waiverGateMessage}</p>
            ) : null}
            {!publicLoading && t && claimsClosed ? (
              <p className="text-xs text-white/50">Captain claim slots are currently full.</p>
            ) : null}
            {!publicLoading && t && publicData?.full ? (
              <p className="text-xs text-white/50">Tournament field is full.</p>
            ) : null}
            {!token && t ? (
              <p className="text-xs text-white/50">Log in to submit a captain claim.</p>
            ) : null}
          </div>
        </div>

        <Panel className="p-6 md:p-8">
          <h2 className="text-2xl font-bold uppercase tracking-tight text-white md:text-3xl">
            Tournament Overview
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75">
            A captain claim reserves one potential team place. The tournament is only confirmed
            once the minimum number of approved teams is reached, and it locks once all team spots are filled.
          </p>

          {publicLoading ? (
            <p className="mt-8 text-sm text-white/60">Loading…</p>
          ) : publicError ? (
            <p className="mt-8 text-sm text-white/60">{publicError}</p>
          ) : !t ? (
            <EmptyStateMessage className="mt-8">
              No tournaments available
            </EmptyStateMessage>
          ) : (
            <>
              {t.title ? (
                <p className="mt-4 text-sm font-medium text-white/85">{t.title}</p>
              ) : null}
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                    Minimum to Confirm
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {t.officialThreshold} Teams
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                    Teams Claimed
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {publicData?.claimedTeams ?? 0} / {t.maxTeams}
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                    Spots Remaining
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.max(0, t.maxTeams - (publicData?.claimedTeams ?? 0))}
                  </div>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      {waiverModalOpen && token ? (
        <WaiverAcceptanceModal
          token={token}
          onClose={() => setWaiverModalOpen(false)}
          onAccepted={() => {
            setWaiverModalOpen(false);
            openClaimModalInner();
          }}
        />
      ) : null}

      {modalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black" />

          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 text-black shadow-2xl">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <div className="text-sm font-semibold uppercase tracking-wide text-black/60">
                  {step === "rules" ? "Submission Agreement" : "Claim Your Captain Spot"}
                </div>
                <div className="text-black/80">
                  {step === "rules"
                    ? "You must read and agree before submitting."
                    : "Claiming a captain slot reserves one potential team place for this tournament."}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-sm underline text-black/60"
              >
                Close
              </button>
            </div>

            {step === "rules" ? (
              <>
                <div
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const nearBottom =
                      el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
                    if (nearBottom) setRulesRead(true);
                  }}
                  className="mt-5 h-64 overflow-y-auto rounded-xl border border-black/10 bg-white p-6 space-y-4 text-black/80"
                >
                  <div className="font-semibold uppercase text-black/90">
                    Rules and Eligibility
                  </div>

                  <p>
                    Captains and players must submit their entry at least 48 hours before
                    the tournament start time.
                  </p>

                  <p>
                    Team spots are limited. Once the maximum number of teams is reached,
                    the tournament is considered full.
                  </p>

                  <p>The count can change as submissions are approved or removed.</p>

                  <p>Once the tournament is full, additional teams will not be included.</p>

                  <p>
                    Minimum roster size is required to submit a team. The goalkeeper does
                    count toward your minimum player total.
                  </p>

                  <p>
                    Claiming a captain spot does not fully confirm your team. Final approval
                    depends on payment, roster verification, eligibility, and admin review.
                  </p>
                </div>

                <div className="mt-5 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-black/80">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    I agree to the rules and eligibility requirements.
                  </label>

                  <input
                    placeholder="Type your full name"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    className="w-full rounded-md border border-black/20 px-4 py-2 text-sm"
                  />

                  <button
                    type="button"
                    onClick={submitAgreement}
                    disabled={!rulesRead || !agreed || !typedName.trim()}
                    className="w-full rounded-md bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Submit
                  </button>
                </div>
              </>
            ) : !claimDone ? (
              <div className="mt-6 space-y-6">
                <div className="rounded-xl border border-black/10 bg-black/5 p-5 space-y-4">
                  <div className="text-sm font-semibold uppercase tracking-wide text-black/80">
                    Captain Info
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={captainName}
                      onChange={(e) => setCaptainName(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                    />
                    <input
                      value={captainIg}
                      onChange={(e) => setCaptainIg(e.target.value)}
                      placeholder="Instagram handle"
                      className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 bg-black/5 p-5 space-y-4">
                  <div className="text-sm font-semibold uppercase tracking-wide text-black/80">
                    Team Info
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="Team name"
                      className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                    />
                    <input
                      type="number"
                      value={expectedPlayers}
                      onChange={(e) => setExpectedPlayers(Number(e.target.value))}
                      min={5}
                      max={25}
                      placeholder="Expected players"
                      className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                    />
                  </div>

                  <div className="text-xs text-black/55">
                    Optional: early roster entries (preliminary only). These do not count as verified registration.
                  </div>

                  <div className="space-y-3">
                    {prelimRoster.map((p, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-5">
                        <input
                          value={p.fullName}
                          onChange={(e) => updatePrelim(i, "fullName", e.target.value)}
                          placeholder="Full name"
                          className="sm:col-span-2 rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                        />
                        <input
                          value={p.instagram}
                          onChange={(e) => updatePrelim(i, "instagram", e.target.value)}
                          placeholder="Instagram"
                          className="sm:col-span-2 rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black placeholder:text-black/35 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removePrelim(i)}
                          className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black/80"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addPrelimRow}
                      className="text-sm text-black/70 hover:underline underline-offset-4"
                    >
                      Add early roster entry
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={submitClaim}
                    disabled={
                      !captainName.trim() ||
                      !captainIg.trim() ||
                      !teamName.trim() ||
                      !expectedPlayers ||
                      submitting
                    }
                    className="rounded-md bg-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? "Submitting…" : "Claim Your Captain Spot"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold text-black/85"
                  >
                    Cancel
                  </button>
                </div>

                {error ? <div className="text-sm text-red-600">{error}</div> : null}
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="rounded-xl border border-black/10 bg-black/5 p-6 text-sm text-black/80 whitespace-pre-line">
                  Your captain interest has been recorded. Your team spot is not confirmed yet. Confirmation only happens after payment, eligibility review, roster verification, and final approval.
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={goToPayment}
                    disabled={payBusy}
                    className="rounded-md bg-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {payBusy ? "Starting checkout…" : "Proceed to payment ($250)"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold text-black/85"
                  >
                    Close
                  </button>
                </div>

                {error ? <div className="text-sm text-red-600">{error}</div> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
