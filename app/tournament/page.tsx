"use client";

import { useEffect, useState } from "react";
import {
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";

type Prelim = {
  fullName: string;
  instagram: string;
};

export default function TournamentPage() {
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

  useEffect(() => {
    if (!modalOpen) {
      setStep("rules");
      setRulesRead(false);
      setAgreed(false);
      setTypedName("");
    }
  }, [modalOpen]);

  function openClaimModal() {
    setError(null);
    setClaimDone(false);
    setStep("rules");
    setRulesRead(false);
    setAgreed(false);
    setTypedName(captainName || "");
    setModalOpen(true);
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
    setSubmitting(true);
    setError(null);

    try {
      await new Promise((r) => setTimeout(r, 900));
      setClaimDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function goToPayment() {
    setPayBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <PageShell className="pb-16 pt-2">
      <TopNav />

      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <div className="space-y-10">
          <div className="space-y-3">
            <SectionEyebrow>Tournament Status</SectionEyebrow>
            <div className="text-4xl font-semibold text-white md:text-5xl">Planning</div>
            <p className="text-sm text-white/55">
              The tournament becomes confirmed once the minimum team threshold is reached.
            </p>
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
              onClick={openClaimModal}
              className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-black"
            >
              CLAIM A TEAM
            </button>
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

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                Minimum to Confirm
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">8 Teams</div>
            </div>

            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                Teams Claimed
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">1 / 12</div>
            </div>

            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                Spots Remaining
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">11</div>
            </div>
          </div>
        </Panel>
      </div>

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

                    <p>
                      The count can change as submissions are approved or removed.
                    </p>

                    <p>
                      Once the tournament is full, additional teams will not be included.
                    </p>

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
                </div>
              )}
            </div>
          </div>
        )}
    </PageShell>
  );
}
