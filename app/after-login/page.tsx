"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TourneyStatus = "confirmed" | "planning" | "inactive";
type PickupStatus = "open" | "invite_only" | "inactive";

function ReasonPicker({
  label,
  onDone,
}: {
  label: string;
  onDone: (payload: { reasonQuick?: string; reasonNote?: string }) => void;
}) {
  const [quick, setQuick] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");

  const options = [
    "Schedule conflict",
    "Injury",
    "Out of town",
    "Work / school",
    "Not interested",
    "Other",
  ];

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-5">
      <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
        {label}
      </div>
      <div className="mt-2 text-sm text-white/75">
        Is there a reason you can’t play?
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setQuick(o)}
            className={[
              "rounded-full px-3 py-1.5 text-xs border",
              quick === o
                ? "border-white/25 bg-white/10 text-white/90"
                : "border-white/10 text-white/55 hover:bg-white/[0.04]",
            ].join(" ")}
          >
            {o}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note…"
        className="mt-3 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
        rows={3}
      />

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onDone({ reasonQuick: quick, reasonNote: note.trim() || undefined })}
          className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default function AfterLoginPage() {
  const router = useRouter();

  const [enter, setEnter] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tournamentStatus, setTournamentStatus] = useState<TourneyStatus>("planning");
  const [pickupStatus, setPickupStatus] = useState<PickupStatus>("invite_only");

  const [aiText, setAiText] = useState("");
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const [tourneyAnswer, setTourneyAnswer] = useState<"yes" | "no" | null>(null);
  const [pickupAnswer, setPickupAnswer] = useState<"yes" | "no" | null>(null);

  const showTournamentAsk = tournamentStatus === "planning" || tournamentStatus === "confirmed";
  const showPickupAsk = pickupStatus === "open" || pickupStatus === "invite_only";

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const tournamentPill = useMemo(() => {
    if (tournamentStatus === "confirmed") {
      return { label: "CONFIRMED", cls: "border-emerald-500/25 bg-emerald-500/15 text-emerald-200" };
    }
    if (tournamentStatus === "planning") {
      return { label: "PLANNING", cls: "border-white/15 bg-white/10 text-white/85" };
    }
    return { label: "NOT ANNOUNCED", cls: "border-red-500/25 bg-red-500/15 text-red-200" };
  }, [tournamentStatus]);

  const pickupPill = useMemo(() => {
    if (pickupStatus === "open") return { label: "OPEN", cls: "border-emerald-500/25 bg-emerald-500/15 text-emerald-200" };
    if (pickupStatus === "invite_only") return { label: "INVITE ONLY", cls: "border-white/15 bg-white/10 text-white/85" };
    return { label: "NOT ACTIVE", cls: "border-red-500/25 bg-red-500/15 text-red-200" };
  }, [pickupStatus]);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/status/summary");
        const sj = await s.json();

        const t: TourneyStatus = sj?.tournamentStatus || "planning";
        const p: PickupStatus = sj?.pickupStatus || "invite_only";

        setTournamentStatus(t);
        setPickupStatus(p);

        const nothingActive = t === "inactive" && p === "inactive";

        if (nothingActive) {
          // Keep the site clean: brief confirmation then return home (still logged in)
          setAiText("You’re logged in. No active tournament or pickup updates right now.");
          setLoading(false);

          setTimeout(() => {
            router.replace("/");
          }, 1100);

          return;
        }

        // OpenAI status message
        const r = await fetch("/api/after-login/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentStatus: t, pickupStatus: p }),
        });
        const rj = await r.json();
        setAiText(String(rj?.text || "You’re logged in."));
      } catch {
        setAiText("You’re logged in. Updates will be posted here first.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  function finishAndGoHome(extra?: string) {
    setDoneMsg(extra || "All set. You’re logged in now.");
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div
        className={[
          "mx-auto max-w-4xl px-6 py-14 space-y-10",
          "transition-all duration-500",
          enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">WELCOME</h1>
          <Link
            href="/"
            className="text-sm text-white/70 hover:text-white hover:underline underline-offset-4"
          >
            Home
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className={`rounded-full px-4 py-2 text-sm font-semibold border ${tournamentPill.cls}`}>
              TOURNAMENT · {tournamentPill.label}
            </div>
            <div className={`rounded-full px-4 py-2 text-sm font-semibold border ${pickupPill.cls}`}>
              PICKUP · {pickupPill.label}
            </div>
          </div>

          <div className="mt-5 text-base text-white/85 whitespace-pre-line min-h-[64px]">
            {loading ? "Checking status…" : aiText}
          </div>

          {/* If we already finished (after reasons), show final */}
          {doneMsg && (
            <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-5">
              <div className="text-sm text-white/80">{doneMsg}</div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => router.replace("/")}
                  className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
                >
                  Return to home
                </button>
              </div>
            </div>
          )}

          {/* Questions */}
          {!doneMsg && (showTournamentAsk || showPickupAsk) && (
            <div className="mt-6 space-y-4">
              {showTournamentAsk && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                  <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                    Tournament
                  </div>
                  <div className="mt-2 text-sm text-white/75">
                    Would you be willing to play in the next tournament?
                  </div>

                  {tourneyAnswer === null && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTourneyAnswer("yes");
                        }}
                        className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setTourneyAnswer("no")}
                        className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04]"
                      >
                        No
                      </button>
                    </div>
                  )}

                  {tourneyAnswer === "yes" && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href="/tournament"
                        className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
                      >
                        Continue
                      </Link>
                      <button
                        type="button"
                        onClick={() => finishAndGoHome("Perfect. You’re logged in.")}
                        className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04]"
                      >
                        Return to home
                      </button>
                    </div>
                  )}

                  {tourneyAnswer === "no" && (
                    <ReasonPicker
                      label="Tournament"
                      onDone={() => {
                        // If pickup also needs an answer, let them do that too.
                        if (showPickupAsk && pickupAnswer === null) return;
                        finishAndGoHome("Thanks. You’re logged in now.");
                      }}
                    />
                  )}
                </div>
              )}

              {showPickupAsk && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                  <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                    Pickup
                  </div>
                  <div className="mt-2 text-sm text-white/75">
                    Do you want to be considered for pickup runs?
                  </div>

                  {pickupAnswer === null && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setPickupAnswer("yes");
                        }}
                        className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickupAnswer("no")}
                        className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04]"
                      >
                        No
                      </button>
                    </div>
                  )}

                  {pickupAnswer === "yes" && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href="/pickup"
                        className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black"
                      >
                        Continue
                      </Link>
                      <button
                        type="button"
                        onClick={() => finishAndGoHome("Perfect. You’re logged in.")}
                        className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04]"
                      >
                        Return to home
                      </button>
                    </div>
                  )}

                  {pickupAnswer === "no" && (
                    <ReasonPicker
                      label="Pickup"
                      onDone={() => {
                        if (showTournamentAsk && tourneyAnswer === null) return;
                        finishAndGoHome("Thanks. You’re logged in now.");
                      }}
                    />
                  )}
                </div>
              )}

              {/* If they answered everything, let them go home */}
              {( (!showTournamentAsk || tourneyAnswer !== null) &&
                 (!showPickupAsk || pickupAnswer !== null) ) && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => finishAndGoHome("All set. You’re logged in now.")}
                    className="text-sm text-white/70 hover:text-white hover:underline underline-offset-4"
                  >
                    Return to home
                  </button>
                </div>
              )}
            </div>
          )}

          {!doneMsg && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="text-sm text-white/70 hover:text-white hover:underline underline-offset-4"
              >
                Continue to home
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
