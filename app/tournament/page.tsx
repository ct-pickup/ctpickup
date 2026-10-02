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
import { IN_PERSON_TOURNAMENT_REFUND_NOTICE_UI } from "@/lib/fees/refundPolicyCopy";
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
  if (d.official) return "Official";
  return "Open for entries";
}

function statusBlurb(d: TournamentPublic | null) {
  if (!d?.tournament) {
    return "There is no active tournament right now. Check back soon.";
  }
  if (d.full) {
    return "All team slots are filled.";
  }
  if (d.official) {
    return "The field is official. Spots may remain until the roster cap is reached.";
  }
  return "The field becomes official once enough teams are approved.";
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
            ? data.error.replace(/_/g, "  ")
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
            ? j.error.replace(/_/g, "  ")
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
              <div className="text-h2 font-serif font-semibold text-muted md:text-h1">Loading…</div>
            ) : publicError ? (
              <>
                <div className="text-h2 font-serif font-semibold text-ink md:text-h1">Unavailable</div>
                <p className="text-small text-muted">{publicError}</p>
              </>
            ) : (
              <>
                <div className="text-display font-serif font-semibold text-ink md:text-display">
                  {statusHeadline(publicData)}
                </div>
                {!t ? (
                  <EmptyStateMessage className="mt-2">
                    No tournament is open right now
                  </EmptyStateMessage>
                ) : (
                  <p className="text-small text-muted">{statusBlurb(publicData)}</p>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-h3 font-serif font-semibold text-ink md:text-h2">
              Captain-Based Entry
            </h2>
            <p className="text-small leading-7 text-muted">
              Captains claim a team slot first. Final approval depends on payment,
              roster verification, eligibility review, and admin approval.
            </p>

            <button
              type="button"
              onClick={() => void openClaimModal()}
              disabled={claimDisabled || !!publicError || checkingWaiver}
              className="rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checkingWaiver ? "Checking…" : "CLAIM A TEAM"}
            </button>
            {waiverGateMessage ? (
              <p className="text-caption font-medium text-coral-text">{waiverGateMessage}</p>
            ) : null}
            {!publicLoading && t && claimsClosed ? (
              <p className="text-caption text-muted">Captain claim slots are currently full.</p>
            ) : null}
            {!publicLoading && t && publicData?.full ? (
              <p className="text-caption text-muted">Tournament field is full.</p>
            ) : null}
            {!token && t ? (
              <p className="text-caption text-muted">Log in to submit a captain claim.</p>
            ) : null}
          </div>
        </div>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h2 font-serif font-bold text-ink">
            Tournament Overview
          </h2>
          <p className="mt-4 max-w-2xl text-small leading-7 text-muted">
            A captain claim reserves one potential team place. The tournament is only confirmed
            once the minimum number of approved teams is reached, and it locks once all team spots are filled.
          </p>

          {publicLoading ? (
            <p className="mt-8 text-small text-muted">Loading…</p>
          ) : publicError ? (
            <p className="mt-8 text-small text-muted">{publicError}</p>
          ) : !t ? (
            <EmptyStateMessage className="mt-8">
              No tournaments available
            </EmptyStateMessage>
          ) : (
            <>
              {t.title ? (
                <p className="mt-4 text-small font-medium text-ink">{t.title}</p>
              ) : null}
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-card border border-line bg-card p-4">
                  <div className="text-caption font-semibold text-muted">
                    Minimum to Confirm
                  </div>
                  <div className="mt-2 text-h2 font-serif font-semibold text-ink">
                    {t.officialThreshold} Teams
                  </div>
                </div>

                <div className="rounded-card border border-line bg-card p-4">
                  <div className="text-caption font-semibold text-muted">
                    Teams Claimed
                  </div>
                  <div className="mt-2 text-h2 font-serif font-semibold text-ink">
                    {publicData?.claimedTeams ?? 0} / {t.maxTeams}
                  </div>
                </div>

                <div className="rounded-card border border-line bg-card p-4">
                  <div className="text-caption font-semibold text-muted">
                    Spots Remaining
                  </div>
                  <div className="mt-2 text-h2 font-serif font-semibold text-ink">
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
          <div className="absolute inset-0 bg-canvas" />

          <div className="relative z-10 w-full max-w-2xl rounded-card border border-line bg-card p-6 text-ink">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <div className="text-small font-semibold text-ink">
                  {step === "rules" ? "Submission Agreement" : "Claim Your Captain Spot"}
                </div>
                <div className="text-ink">
                  {step === "rules"
                    ? "You must read and agree before submitting."
                    : "Claiming a captain slot reserves one potential team place for this tournament."}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-small underline text-ink"
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
                  className="mt-5 h-64 overflow-y-auto rounded-card border border-line bg-card p-6 space-y-4 text-ink"
                >
                  <div className="font-semibold text-ink">
                    Rules and Eligibility
                  </div>

                  <p>
                    Captains and players must submit their entry at least 48 hours before
                    the tournament start time.
                  </p>

                  <div className="font-semibold text-ink">Entry fees &amp; refunds</div>
                  <p>{IN_PERSON_TOURNAMENT_REFUND_NOTICE_UI}</p>

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

                  <div className="font-semibold text-ink">
                    Photo, video &amp; online use
                  </div>

                  <p>
                    By participating in this tournament (and related CT Pickup activities),
                    you confirm you have accepted the current Liability Waiver &amp;
                    Participation Agreement, including consent for CT Pickup to photograph,
                    record audio and video, livestream, and publish your name, image,
                    likeness, and voice online and in other media as described there. That
                    consent is required and is not negotiable if you play.
                  </p>
                </div>

                <div className="mt-5 space-y-3">
                  <label className="flex items-center gap-2 text-small text-ink">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    I agree to the rules, eligibility requirements, and media consent
                    described above.
                  </label>

                  <input
                    placeholder="Type your full name"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    className="w-full rounded-button border border-line px-4 py-2 text-small"
                  />

                  <button
                    type="button"
                    onClick={submitAgreement}
                    disabled={!rulesRead || !agreed || !typedName.trim()}
                    className="w-full rounded-button bg-canvas px-5 py-3 text-small font-semibold text-ink disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Submit
                  </button>
                </div>
              </>
            ) : !claimDone ? (
              <div className="mt-6 space-y-6">
                <div className="rounded-card border border-line bg-card p-5 space-y-4">
                  <div className="text-small font-semibold text-ink">
                    Captain Info
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={captainName}
                      onChange={(e) => setCaptainName(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                    />
                    <input
                      value={captainIg}
                      onChange={(e) => setCaptainIg(e.target.value)}
                      placeholder="Instagram handle"
                      className="w-full rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-card border border-line bg-card p-5 space-y-4">
                  <div className="text-small font-semibold text-ink">
                    Team Info
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="Team name"
                      className="w-full rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                    />
                    <input
                      type="number"
                      value={expectedPlayers}
                      onChange={(e) => setExpectedPlayers(Number(e.target.value))}
                      min={5}
                      max={25}
                      placeholder="Expected players"
                      className="w-full rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                    />
                  </div>

                  <div className="text-caption text-ink">
                    Optional: early roster entries (preliminary only). These do not count as verified registration.
                  </div>

                  <div className="space-y-3">
                    {prelimRoster.map((p, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-5">
                        <input
                          value={p.fullName}
                          onChange={(e) => updatePrelim(i, "fullName", e.target.value)}
                          placeholder="Full name"
                          className="sm:col-span-2 rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                        />
                        <input
                          value={p.instagram}
                          onChange={(e) => updatePrelim(i, "instagram", e.target.value)}
                          placeholder="Instagram"
                          className="sm:col-span-2 rounded-card border border-line bg-card px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removePrelim(i)}
                          className="rounded-card border border-line bg-pitch px-4 py-3 text-small text-on-pitch"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addPrelimRow}
                      className="text-small text-ink hover:underline underline-offset-4"
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
                    className="rounded-button bg-canvas px-5 py-2.5 text-small font-semibold text-ink disabled:opacity-50"
                  >
                    {submitting ? "Submitting…" : "Claim Your Captain Spot"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-button border border-line bg-pitch px-5 py-2.5 text-small font-semibold text-on-pitch"
                  >
                    Cancel
                  </button>
                </div>

                {error ? <div className="text-small text-coral-text">{error}</div> : null}
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="rounded-card border border-line bg-card p-6 text-small text-ink whitespace-pre-line">
                  Your captain interest has been recorded. Your team spot is not confirmed yet. Confirmation only happens after payment, eligibility review, roster verification, and final approval.
                </div>

                <div className="rounded-card border border-line bg-card p-4 text-caption leading-relaxed text-ink">
                  <span className="font-semibold text-ink">Before you pay:</span>{"  "}
                  {IN_PERSON_TOURNAMENT_REFUND_NOTICE_UI}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={goToPayment}
                    disabled={payBusy}
                    className="rounded-button bg-canvas px-5 py-2.5 text-small font-semibold text-ink disabled:opacity-50"
                  >
                    {payBusy ? "Starting checkout…" : `Proceed to payment ($${Math.max(5, Math.min(25, expectedPlayers)) * 50})`}
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-button border border-line bg-pitch px-5 py-2.5 text-small font-semibold text-on-pitch"
                  >
                    Close
                  </button>
                </div>

                {error ? <div className="text-small text-coral-text">{error}</div> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
