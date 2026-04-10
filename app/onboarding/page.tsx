"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HistoryBack } from "@/components/layout";
import { EsportsGoaliePreferenceFields } from "@/components/profile/EsportsGoaliePreferenceFields";
import { APP_HOME_FIRST_VISIT_URL, APP_HOME_URL } from "@/lib/siteNav";
import {
  bindEsportsPreferenceHandlers,
  esportsDetailsComplete,
  profileEsportsPreferenceColumns,
  type EsportsConsole,
  type EsportsInterest,
  type EsportsPlatform,
} from "@/lib/profilePreferences";
import {
  isMissingProfileColumnError,
  profileSchemaMismatchUserMessage,
} from "@/lib/profileLoad";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import {
  PROFILE_GENDER_LABELS,
  type ProfileGender,
  profileIdentityColumns,
  normalizePlayingPosition,
} from "@/lib/profileIdentityFields";

function cleanIG(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export default function OnboardingPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<ProfileGender | "">("");
  const [genderOther, setGenderOther] = useState("");
  const [playingPosition, setPlayingPosition] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);

  const [esportsInterest, setEsportsInterest] = useState<EsportsInterest | null>(null);
  const [esportsPlatform, setEsportsPlatform] = useState<EsportsPlatform | null>(null);
  const [esportsConsole, setEsportsConsole] = useState<EsportsConsole | null>(null);
  const [esportsOnlineId, setEsportsOnlineId] = useState("");
  const { onEsportsInterest, onEsportsPlatform } = useMemo(
    () =>
      bindEsportsPreferenceHandlers({
        setInterest: setEsportsInterest,
        setPlatform: setEsportsPlatform,
        setConsole: setEsportsConsole,
        setOnlineId: setEsportsOnlineId,
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
        .select("first_name")
        .eq("id", auth.user.id)
        .maybeSingle();

      if (profile) {
        window.location.href = APP_HOME_URL;
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
    if (!gender) return setMsg("Sex / gender is required.");
    if (!normalizePlayingPosition(playingPosition)) return setMsg("Playing position is required.");
    if (!ig) return setMsg("Instagram is required.");
    if (!phone.trim()) return setMsg("Phone is required.");
    if (!waiverAccepted) return setMsg("Please accept the Liability Waiver to continue.");
    if (esportsInterest === null) {
      return setMsg("Answer the online tournament question.");
    }
    if (
      !esportsDetailsComplete({
        esports_interest: esportsInterest,
        esports_platform: esportsPlatform,
        esports_console: esportsConsole,
        esports_online_id: esportsOnlineId,
      })
    ) {
      return setMsg(
        "You said yes to online tournaments — add platform, console, and your gamertag or online ID.",
      );
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const profileEmail = auth.user.email?.trim().toLowerCase() ?? null;
    const prefs = profileEsportsPreferenceColumns({
      esportsInterest,
      esportsPlatform,
      esportsConsole,
      esportsOnlineId,
    });

    const identity = profileIdentityColumns({
      firstName,
      lastName,
      gender: gender as ProfileGender,
      genderOther,
      playingPosition,
    });

    const { error } = await supabase.from("profiles").upsert(
      {
        id: auth.user.id,
        email: profileEmail,
        first_name: identity.first_name,
        last_name: identity.last_name,
        gender: identity.gender,
        gender_other: identity.gender_other,
        playing_position: identity.playing_position,
        instagram: ig,
        phone: phone.trim(),
        esports_interest: prefs.esports_interest,
        esports_platform: prefs.esports_platform,
        esports_console: prefs.esports_console,
        esports_online_id: prefs.esports_online_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("[onboarding] profiles upsert failed:", error.message, error);
      if (isMissingProfileColumnError(error.message)) {
        console.error("[onboarding] Apply profile migrations (see lib/profileLoad.ts).");
      }
      return setMsg(
        isMissingProfileColumnError(error.message)
          ? profileSchemaMismatchUserMessage()
          : error.message,
      );
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

    window.location.href = APP_HOME_FIRST_VISIT_URL;
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
        fallbackHref="/"
        className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
      />
      <h1 className="text-2xl font-semibold">New here?</h1>
      <p className="mt-2 text-sm text-gray-600">
        Instagram + phone are required so we can verify identity and contact you quickly
        once a slot hits critical mass.
      </p>

      <div className="mt-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="rounded-lg border p-3" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
          <input className="rounded-lg border p-3" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </div>

        <div className="w-full">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
            Sex / gender
          </label>
          <select
            className="rounded-lg border p-3 w-full bg-white"
            value={gender}
            onChange={(e) => setGender(e.target.value as any)}
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="male">{PROFILE_GENDER_LABELS.male}</option>
            <option value="female">{PROFILE_GENDER_LABELS.female}</option>
            <option value="other">{PROFILE_GENDER_LABELS.other}</option>
          </select>
        </div>

        {gender === "other" ? (
          <input
            className="rounded-lg border p-3 w-full"
            placeholder="Describe (optional)"
            value={genderOther}
            onChange={(e) => setGenderOther(e.target.value)}
            maxLength={64}
          />
        ) : null}

        <input
          className="rounded-lg border p-3 w-full"
          placeholder="Playing position"
          value={playingPosition}
          onChange={(e) => setPlayingPosition(e.target.value)}
        />

        <EsportsGoaliePreferenceFields
          variant="light"
          esportsInterest={esportsInterest}
          onEsportsInterest={onEsportsInterest}
          esportsPlatform={esportsPlatform}
          onEsportsPlatform={onEsportsPlatform}
          esportsConsole={esportsConsole}
          onEsportsConsole={setEsportsConsole}
          esportsOnlineId={esportsOnlineId}
          onEsportsOnlineIdChange={setEsportsOnlineId}
        />

        <input
          className="rounded-lg border p-3 w-full"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <input
          className="rounded-lg border p-3 w-full"
          placeholder="Instagram (@handle)"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
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

        {msg ? (
          <p className="text-sm text-red-600 whitespace-pre-line leading-relaxed">{msg}</p>
        ) : null}
      </div>
    </main>
  );
}
