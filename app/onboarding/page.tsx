"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HistoryBack } from "@/components/layout";
import { EsportsGoaliePreferenceFields } from "@/components/profile/EsportsGoaliePreferenceFields";
import { APP_HOME_URL } from "@/lib/siteNav";
import {
  bindEsportsPreferenceHandlers,
  esportsDetailsComplete,
  profileEsportsGoalieColumns,
  type EsportsConsole,
  type EsportsInterest,
  type EsportsPlatform,
} from "@/lib/profilePreferences";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

function cleanIG(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export default function OnboardingPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);

  const [esportsInterest, setEsportsInterest] = useState<EsportsInterest | null>(null);
  const [esportsPlatform, setEsportsPlatform] = useState<EsportsPlatform | null>(null);
  const [esportsConsole, setEsportsConsole] = useState<EsportsConsole | null>(null);
  const [playsGoalie, setPlaysGoalie] = useState<boolean | null>(null);

  const { onEsportsInterest, onEsportsPlatform } = useMemo(
    () =>
      bindEsportsPreferenceHandlers({
        setInterest: setEsportsInterest,
        setPlatform: setEsportsPlatform,
        setConsole: setEsportsConsole,
      }),
    [],
  );

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name,last_name,instagram,phone")
        .eq("id", auth.user.id)
        .maybeSingle();

      if (profile) {
        window.location.href = "/tournament";
        return;
      }

      setLoading(false);
    })();
  }, [supabase, isReady]);

  async function save() {
    if (!isReady || !supabase) return;
    setMsg(null);

    const ig = cleanIG(instagram);
    if (!firstName.trim()) return setMsg("First name is required.");
    if (!lastName.trim()) return setMsg("Last name is required.");
    if (!ig) return setMsg("Instagram is required.");
    if (!phone.trim()) return setMsg("Phone is required.");
    if (!waiverAccepted) return setMsg("Please accept the Liability Waiver to continue.");
    if (esportsInterest === null || playsGoalie === null) {
      return setMsg("Answer the online tournament question and whether you can play goalie.");
    }
    if (
      !esportsDetailsComplete({
        esports_interest: esportsInterest,
        esports_platform: esportsPlatform,
        esports_console: esportsConsole,
      })
    ) {
      return setMsg("You said yes to online tournaments — choose your platform and console.");
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const profileEmail = auth.user.email?.trim().toLowerCase() ?? null;
    const prefs = profileEsportsGoalieColumns({
      esportsInterest,
      esportsPlatform,
      esportsConsole,
      playsGoalie,
    });

    const { error } = await supabase.from("profiles").upsert(
      {
        id: auth.user.id,
        email: profileEmail,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        instagram: ig,
        phone: phone.trim(),
        esports_interest: prefs.esports_interest,
        esports_platform: prefs.esports_platform,
        esports_console: prefs.esports_console,
        plays_goalie: prefs.plays_goalie,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("[onboarding] profiles upsert failed:", error.message, error);
      return setMsg(error.message);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return setMsg("Session not found. Please log in again.");

    const acceptRes = await fetch("/api/waiver/accept", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ acknowledge: true }),
    });
    if (!acceptRes.ok) {
      const aj = await acceptRes.json().catch(() => ({}));
      return setMsg(
        typeof aj?.error === "string"
          ? `Could not record waiver (${aj.error.replace(/_/g, " ")}).`
          : "Could not record waiver acceptance."
      );
    }

    window.location.href = "/tournament";
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <HistoryBack
          fallbackHref="/login"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        />
        <h1 className="text-2xl font-semibold">Setting up…</h1>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <HistoryBack
        fallbackHref={APP_HOME_URL}
        className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
      />
      <h1 className="text-2xl font-semibold">New here?</h1>
      <p className="mt-2 text-sm text-gray-600">
        Instagram + phone are required so we can verify identity and contact you quickly
        once a slot hits critical mass.
      </p>

      <div className="mt-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="rounded-lg border p-3" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className="rounded-lg border p-3" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>

        <input className="rounded-lg border p-3 w-full" placeholder="Instagram (@handle)" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
        <input className="rounded-lg border p-3 w-full" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />

        <EsportsGoaliePreferenceFields
          variant="light"
          esportsInterest={esportsInterest}
          onEsportsInterest={onEsportsInterest}
          esportsPlatform={esportsPlatform}
          onEsportsPlatform={onEsportsPlatform}
          esportsConsole={esportsConsole}
          onEsportsConsole={setEsportsConsole}
          playsGoalie={playsGoalie}
          onPlaysGoalie={setPlaysGoalie}
        />

        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={waiverAccepted}
            onChange={(e) => setWaiverAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            I agree to the{" "}
            <Link
              href="/liability-waiver"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-gray-900 underline"
            >
              Liability Waiver
            </Link>{" "}
            ({CURRENT_WAIVER_VERSION}).
          </span>
        </label>

        <button className="rounded-lg border px-4 py-3 font-medium" onClick={save}>
          Save & continue
        </button>

        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
      </div>
    </main>
  );
}
