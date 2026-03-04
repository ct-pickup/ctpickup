"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_DAY = "Saturday";
const PRIMARY_TIME = "2:00 PM";
const SECONDARY_TIME = "5:00 PM";

export default function TournamentPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ first: string; last: string; ig: string; phone: string } | null>(null);

  const [wantsTournament, setWantsTournament] = useState<boolean | null>(null);
  const [dayWorks, setDayWorks] = useState<boolean | null>(null);
  const [preferredDay, setPreferredDay] = useState("");
  const [timeChoice, setTimeChoice] = useState<"primary" | "secondary" | "neither" | null>(null);
  const [altTime, setAltTime] = useState("");
  const [captain, setCaptain] = useState<boolean | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [cooldown, setCooldown] = useState(0);

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

  async function submit() {
    setMsg(null);
    if (cooldown > 0) return;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const payload = {
      user_id: auth.user.id,
      wants_tournament: wantsTournament === true,
      day_works: wantsTournament ? dayWorks : null,
      preferred_day: wantsTournament && dayWorks === false ? (preferredDay.trim() || null) : null,
      time_choice: wantsTournament ? timeChoice : null,
      alt_time: wantsTournament && timeChoice === "neither" ? (altTime.trim() || null) : null,
      captain: wantsTournament ? (captain ?? false) : false,
    };

    const { error } = await supabase.from("tourney_submissions").insert(payload);
    if (error) return setMsg(error.message);

    setSubmitted(true);
    setCooldown(10);
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold">Loading…</h1>
      </main>
    );
  }

  if (!profile) return null;

  if (submitted) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold">Submission received</h1>

        <div className="mt-6 rounded-xl border p-4 space-y-2">
          <div className="font-semibold text-sm">Your submission</div>
          <div><span className="text-gray-500">Name:</span> {profile.first} {profile.last}</div>
          <div><span className="text-gray-500">Instagram:</span> @{profile.ig}</div>
          <div><span className="text-gray-500">Phone:</span> {profile.phone}</div>
          <div><span className="text-gray-500">Wants tournament:</span> {wantsTournament ? "Yes" : "No"}</div>
        </div>

        <div className="mt-6 flex gap-3 items-center">
          <a className="underline" href="/status">Go to Status</a>
          <button
            className="rounded-lg border px-4 py-2"
            onClick={() => setSubmitted(false)}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `Resubmit in ${cooldown}s` : "Submit another response"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold">Tournament</h1>

      <div className="mt-6 space-y-4 rounded-xl border p-4">
        <div>
          <div className="font-medium">Just confirming: do you want to play in the tournament?</div>
          <div className="mt-2 flex gap-2">
            <button className="rounded-lg border px-4 py-2" onClick={() => setWantsTournament(true)}>Yes</button>
            <button className="rounded-lg border px-4 py-2" onClick={() => setWantsTournament(false)}>No</button>
          </div>
        </div>

        {wantsTournament === true ? (
          <>
            <div>
              <div className="font-medium">We’re planning the tournament on {DEFAULT_DAY}. Does that work?</div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg border px-4 py-2" onClick={() => setDayWorks(true)}>Yes</button>
                <button className="rounded-lg border px-4 py-2" onClick={() => setDayWorks(false)}>No</button>
              </div>
              {dayWorks === false ? (
                <input
                  className="mt-2 w-full rounded-lg border p-3"
                  placeholder="What day works best for you?"
                  value={preferredDay}
                  onChange={(e) => setPreferredDay(e.target.value)}
                />
              ) : null}
            </div>

            {dayWorks === true ? (
              <div>
                <div className="font-medium">Great. Which time works?</div>
                <div className="mt-2 space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="time" onChange={() => setTimeChoice("primary")} />
                    Primary ({PRIMARY_TIME})
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="time" onChange={() => setTimeChoice("secondary")} />
                    Secondary ({SECONDARY_TIME})
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="time" onChange={() => setTimeChoice("neither")} />
                    Neither (suggest alternative)
                  </label>
                </div>
                {timeChoice === "neither" ? (
                  <input
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="What day/time works for you?"
                    value={altTime}
                    onChange={(e) => setAltTime(e.target.value)}
                  />
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="font-medium">Are you looking to be a team captain?</div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg border px-4 py-2" onClick={() => setCaptain(true)}>Yes</button>
                <button className="rounded-lg border px-4 py-2" onClick={() => setCaptain(false)}>No</button>
              </div>
            </div>
          </>
        ) : null}

        <button
          className="rounded-lg border px-4 py-3 font-medium"
          onClick={submit}
          disabled={
            cooldown > 0 ||
            wantsTournament === null ||
            (wantsTournament === true && dayWorks === null) ||
            (wantsTournament === true && dayWorks === false && !preferredDay.trim()) ||
            (wantsTournament === true && dayWorks === true && !timeChoice) ||
            (wantsTournament === true && timeChoice === "neither" && !altTime.trim()) ||
            (wantsTournament === true && captain === null)
          }
        >
          {cooldown > 0 ? `Wait ${cooldown}s` : "Submit"}
        </button>

        {msg ? <p className="text-sm text-red-600">Error: {msg}</p> : null}
      </div>
    </main>
  );
}