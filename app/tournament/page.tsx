"use client";

import Topbar from "@/components/Topbar";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_DAY = "Saturday";
const PRIMARY_TIME = "2:00 PM";
const SECONDARY_TIME = "5:00 PM";

type TimeChoice = "primary" | "secondary" | "neither";

function pct(n: number, total: number) {
  return `${Math.round((n / total) * 100)}%`;
}

export default function TournamentPage() {
  const totalSteps = 6;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ first: string; last: string; ig: string; phone: string } | null>(null);

  const [step, setStep] = useState(1);

  const [wantsTournament, setWantsTournament] = useState<boolean | null>(null);
  const [dayWorks, setDayWorks] = useState<boolean | null>(null);
  const [preferredDay, setPreferredDay] = useState("");
  const [timeChoice, setTimeChoice] = useState<TimeChoice | null>(null);
  const [altTime, setAltTime] = useState("");
  const [captain, setCaptain] = useState<boolean | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [cooldown, setCooldown] = useState(0);

  const timestamp = useMemo(() => new Date().toLocaleString(), []);

  useEffect(() => {
    const t = cooldown > 0 ? setInterval(() => setCooldown((c) => c - 1), 1000) : null;
    return () => { if (t) clearInterval(t); };
  }, [cooldown]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name,last_name,instagram,phone")
        .eq("id", auth.user.id)
        .maybeSingle();

      if (!prof) {
        window.location.href = "/onboarding";
        return;
      }

      setProfile({
        first: prof.first_name,
        last: prof.last_name,
        ig: prof.instagram,
        phone: prof.phone,
      });

      setLoading(false);
    })();
  }, []);

  function back() {
    setMsg(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function submitDeclined() {
    setMsg(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const payload = {
      user_id: auth.user.id,
      wants_tournament: false,
      day_works: null,
      preferred_day: null,
      time_choice: null,
      alt_time: null,
      captain: false,
    };

    const { error } = await supabase.from("tourney_submissions").insert(payload);
    if (error) return setMsg(error.message);

    setSubmitted(true);
    setCooldown(10);
  }

  async function submitYes() {
    setMsg(null);
    if (cooldown > 0) return;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const payload = {
      user_id: auth.user.id,
      wants_tournament: true,
      day_works: dayWorks,
      preferred_day: dayWorks === false ? (preferredDay.trim() || null) : null,
      time_choice: timeChoice,
      alt_time: timeChoice === "neither" ? (altTime.trim() || null) : null,
      captain: captain ?? false,
    };

    const { error } = await supabase.from("tourney_submissions").insert(payload);
    if (error) return setMsg(error.message);

    setSubmitted(true);
    setCooldown(10);
  }

  if (loading) {
    return (
      <main className="ct-page">
        <div className="ct-container">
          <Topbar />
            <div className="ct-nav">
            <a href="/status">Status</a>
            <a href="/help">Help</a>
            <a href="/update">Fix Submission</a>
          </div>
          </div>
          <div className="ct-card">
            <div className="ct-title">Tournament</div>
            <div className="ct-sub">Loading…</div>
          </div>
        </div>
      </main>
    );
  }

  if (!profile) return null;

  if (submitted) {
    return (
      <main className="ct-page">
        <div className="ct-container">
          <div className="ct-topbar">
            <div className="ct-brand">CT PICKUP</div>
            <div className="ct-nav">
            <a href="/status">Status</a>
            <a href="/help">Help</a>
            <a href="/update">Fix Submission</a>
          </div>
          </div>

          <div className="ct-card">
            <div className="ct-title">Submission received</div>
            <p className="ct-sub">
              If your slot hits critical mass, a CT Pickup member will contact you.
              <br />
              Expected response window: 24–48 hours.
              <br />
              General updates live on Status + IG story.
            </p>

            <div className="mt-5 rounded-xl border p-4" style={{ borderColor: "rgba(255,255,255,0.10)" }}>
              <div className="text-sm font-semibold">Your submission</div>

              <div className="ct-row">
                <div className="ct-k">Name</div>
                <div className="ct-v">{profile.first} {profile.last}</div>
              </div>
              <div className="ct-row">
                <div className="ct-k">Instagram</div>
                <div className="ct-v">@{profile.ig}</div>
              </div>
              <div className="ct-row">
                <div className="ct-k">Phone</div>
                <div className="ct-v">{profile.phone}</div>
              </div>
              <div className="ct-row">
                <div className="ct-k">Wants tournament</div>
                <div className="ct-v">{wantsTournament ? "Yes" : "No"}</div>
              </div>

              {wantsTournament ? (
                <>
                  <div className="ct-row">
                    <div className="ct-k">Day works</div>
                    <div className="ct-v">{dayWorks ? "Yes" : "No"}</div>
                  </div>
                  {!dayWorks ? (
                    <div className="ct-row">
                      <div className="ct-k">Preferred day</div>
                      <div className="ct-v">{preferredDay || "—"}</div>
                    </div>
                  ) : null}
                  <div className="ct-row">
                    <div className="ct-k">Time choice</div>
                    <div className="ct-v">{timeChoice}</div>
                  </div>
                  {timeChoice === "neither" ? (
                    <div className="ct-row">
                      <div className="ct-k">Alt day/time</div>
                      <div className="ct-v">{altTime || "—"}</div>
                    </div>
                  ) : null}
                  <div className="ct-row">
                    <div className="ct-k">Captain</div>
                    <div className="ct-v">{captain ? "Yes" : "No"}</div>
                  </div>
                </>
              ) : null}

              <div className="ct-row">
                <div className="ct-k">Timestamp</div>
                <div className="ct-v">{timestamp}</div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <a className="ct-btn ct-btn-outline" href="/status">Go to Status</a>
              <a className="ct-btn ct-btn-outline" href="/update">Fix / Edit My Submission</a>
              <button
                className="ct-btn ct-btn-primary"
                onClick={() => setSubmitted(false)}
                disabled={cooldown > 0}
              >
                {cooldown > 0 ? `Resubmit in ${cooldown}s` : "Submit another response"}
              </button>
            </div>

            {msg ? <p className="mt-4 text-sm" style={{ color: "#ffb4b4" }}>{msg}</p> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ct-page">
      <div className="ct-container">
        <div className="ct-topbar">
          <div className="ct-brand">CT PICKUP</div>
          <div className="ct-nav">
            <a href="/status">Status</a>
            <a href="/help">Help</a>
            <a href="/update">Fix Submission</a>
          </div>
        </div>

        <h1 className="ct-title">Tournament</h1>
        <p className="ct-sub">
          Logged in as {profile.first} {profile.last} (@{profile.ig}). One quick flow.
        </p>

        <div className="mt-6 ct-card">
          <div className="ct-stepper">
            <div className="ct-steplabel">Step {step} of {totalSteps}</div>
            <div className="ct-bar">
              <div style={{ width: pct(step, totalSteps) }} />
            </div>
          </div>

          {step === 1 ? (
            <>
              <div className="text-xl font-extrabold">Just confirming: do you want to play?</div>
              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-primary" onClick={() => { setWantsTournament(true); setStep(2); }}>
                  Yes
                </button>
                <button className="ct-btn ct-btn-outline" onClick={async () => { setWantsTournament(false); await submitDeclined(); }}>
                  No
                </button>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="text-xl font-extrabold">We’re planning {DEFAULT_DAY}. Does that work?</div>
              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-primary" onClick={() => { setDayWorks(true); setStep(3); }}>
                  Yes
                </button>
                <button className="ct-btn ct-btn-outline" onClick={() => { setDayWorks(false); setStep(3); }}>
                  No
                </button>
              </div>
              <div className="mt-4">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
              </div>
            </>
          ) : null}

          {step === 3 && dayWorks === false ? (
            <>
              <div className="text-xl font-extrabold">What day works best for you?</div>
              <input
                className="ct-input mt-4"
                placeholder="Example: Sunday"
                value={preferredDay}
                onChange={(e) => setPreferredDay(e.target.value)}
              />
              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
                <button
                  className="ct-btn ct-btn-primary"
                  onClick={() => {
                    if (!preferredDay.trim()) return setMsg("Please enter a preferred day.");
                    setMsg(null);
                    setStep(5);
                  }}
                >
                  Continue
                </button>
              </div>
              {msg ? <p className="mt-3 text-sm" style={{ color: "#ffb4b4" }}>{msg}</p> : null}
            </>
          ) : null}

          {step === 3 && dayWorks === true ? (
            <>
              <div className="text-xl font-extrabold">Great. Which time works?</div>
              <div className="mt-4 grid gap-2">
                <button className="ct-btn ct-btn-primary" onClick={() => { setTimeChoice("primary"); setStep(4); }}>
                  Primary ({PRIMARY_TIME})
                </button>
                <button className="ct-btn ct-btn-outline" onClick={() => { setTimeChoice("secondary"); setStep(4); }}>
                  Secondary ({SECONDARY_TIME})
                </button>
                <button className="ct-btn ct-btn-outline" onClick={() => { setTimeChoice("neither"); setStep(4); }}>
                  Neither (suggest alternative)
                </button>
              </div>
              <div className="mt-4">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              {timeChoice === "neither" ? (
                <>
                  <div className="text-xl font-extrabold">What day/time works for you?</div>
                  <input
                    className="ct-input mt-4"
                    placeholder="Example: Sunday 3pm"
                    value={altTime}
                    onChange={(e) => setAltTime(e.target.value)}
                  />
                </>
              ) : (
                <div className="text-xl font-extrabold">Locked. Quick captain question.</div>
              )}

              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
                <button
                  className="ct-btn ct-btn-primary"
                  onClick={() => {
                    if (timeChoice === "neither" && !altTime.trim()) return setMsg("Please suggest an alternative day/time.");
                    setMsg(null);
                    setStep(5);
                  }}
                >
                  Continue
                </button>
              </div>

              {msg ? <p className="mt-3 text-sm" style={{ color: "#ffb4b4" }}>{msg}</p> : null}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="text-xl font-extrabold">Are you looking to be a team captain?</div>
              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-primary" onClick={() => { setCaptain(true); setStep(6); }}>
                  Yes
                </button>
                <button className="ct-btn ct-btn-outline" onClick={() => { setCaptain(false); setStep(6); }}>
                  No
                </button>
              </div>
              <div className="mt-4">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
              </div>
            </>
          ) : null}

          {step === 6 ? (
            <>
              <div className="text-xl font-extrabold">Confirm & submit</div>

              {captain ? (
                <p className="ct-sub">
                  You’re the point of contact. Create an iMessage group chat for your team and make sure every player submits the form.
                </p>
              ) : (
                <p className="ct-sub">
                  Your captain will relay rules and updates. Status page is the source of truth.
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button className="ct-btn ct-btn-outline" onClick={back}>Back</button>
                <button
                  className="ct-btn ct-btn-primary"
                  onClick={submitYes}
                  disabled={cooldown > 0}
                >
                  {cooldown > 0 ? `Wait ${cooldown}s` : "Submit"}
                </button>
              </div>

              {msg ? <p className="mt-3 text-sm" style={{ color: "#ffb4b4" }}>{msg}</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
