"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loginUrlForEsportsRegister,
  signupUrlForEsportsRegister,
} from "@/lib/auth/esportsRegisterUrls";
import { readHasEverSignedUpBrowser } from "@/lib/auth/signupIntent";
import { esportsDocVersionLabel } from "@/lib/legal/esportsDocVersions";
import { ESPORTS_CONFIRMATION_KEYS } from "@/lib/esports/esportsConfirmationKeys";
import { ESPORTS_CONFIRMATION_LABELS } from "@/lib/esports/esportsConfirmationLabels";
import type { EsportsConfirmations } from "@/lib/esports/esportsRegistrationConfirmations";
import { esportsConfirmationsComplete } from "@/lib/esports/esportsRegistrationConfirmations";
import type { PublicEsportsTournament } from "@/lib/esports/fetchPublicEsportsTournaments";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Props = {
  tournament: PublicEsportsTournament;
};

type EsportsPlayerProfile = {
  id: string;
  legal_name: string;
  contact_email: string;
  state: string;
  platform: "playstation" | "xbox";
  psn_id: string | null;
  xbox_gamertag: string | null;
  ea_account: string | null;
  date_of_birth: string | null;
  affirmed_18_plus: boolean;
};

const DOC_LINKS = {
  rules: "/legal/esports/official-rules",
  terms: "/legal/esports/participant-terms",
  privacy: "/legal/esports/privacy-publicity",
} as const;

function emptyConfirmations(): EsportsConfirmations {
  return ESPORTS_CONFIRMATION_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as EsportsConfirmations);
}

export function EsportsTournamentRegistrationClient({ tournament }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { supabase, isReady } = useSupabaseBrowser();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<EsportsPlayerProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [signedName, setSignedName] = useState("");
  const [checks, setChecks] = useState<EsportsConfirmations>(emptyConfirmations);
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const paidQuery = searchParams.get("paid") === "1";
  const canceledQuery = searchParams.get("canceled") === "1";

  useEffect(() => {
    if (!isReady || !supabase) return;
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, isReady]);

  const loadRegistration = useCallback(async () => {
    if (!supabase) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("esports_tournament_registrations")
      .select("id,payment_status,signed_full_name,confirmations")
      .eq("tournament_id", tournament.id)
      .eq("user_id", u.user.id)
      .maybeSingle();
    if (data?.id) {
      setRegistrationId(data.id);
      setPaymentStatus(data.payment_status ?? null);
      if (data.signed_full_name) setSignedName(String(data.signed_full_name));
      const c = data.confirmations as Partial<EsportsConfirmations> | null;
      if (c && esportsConfirmationsComplete(c)) {
        setChecks(c);
      }
    }
  }, [supabase, tournament.id]);

  const loadEsportsProfile = useCallback(async () => {
    setProfileMsg(null);
    try {
      const r = await fetch("/api/esports/player-profile", { method: "GET" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setProfile(null);
        setProfileMsg(typeof j?.error === "string" ? j.error : "Could not load esports profile.");
        return;
      }
      setProfile((j?.profile as EsportsPlayerProfile | null) ?? null);
    } catch {
      setProfile(null);
      setProfileMsg("Could not load esports profile.");
    }
  }, []);

  useEffect(() => {
    if (authed && supabase) {
      void loadEsportsProfile();
      void loadRegistration();
    }
  }, [authed, supabase, loadEsportsProfile, loadRegistration]);

  useEffect(() => {
    if (paidQuery && authed && supabase) void loadRegistration();
  }, [paidQuery, authed, supabase, loadRegistration]);

  useEffect(() => {
    if (authed === false) {
      const first = !readHasEverSignedUpBrowser();
      router.replace(
        first ? signupUrlForEsportsRegister(tournament.id) : loginUrlForEsportsRegister(tournament.id),
      );
    }
  }, [authed, router, tournament.id]);

  const consentReady = useMemo(() => {
    return signedName.trim().length >= 3 && esportsConfirmationsComplete(checks);
  }, [signedName, checks]);

  const profileReady = useMemo(() => {
    if (!profile) return false;
    if (!profile.legal_name?.trim()) return false;
    if (!profile.contact_email?.trim()) return false;
    if (!profile.state?.trim()) return false;
    if (profile.platform === "playstation" && !profile.psn_id) return false;
    if (profile.platform === "xbox" && !profile.xbox_gamertag) return false;
    if (!profile.affirmed_18_plus && !profile.date_of_birth) return false;
    return true;
  }, [profile]);

  const [pfLegalName, setPfLegalName] = useState("");
  const [pfEmail, setPfEmail] = useState("");
  const [pfState, setPfState] = useState("");
  const [pfPlatform, setPfPlatform] = useState<"playstation" | "xbox">("playstation");
  const [pfPsn, setPfPsn] = useState("");
  const [pfXbox, setPfXbox] = useState("");
  const [pfEa, setPfEa] = useState("");
  const [pfDob, setPfDob] = useState("");
  const [pfAff18, setPfAff18] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setPfLegalName(profile.legal_name || "");
    setPfEmail(profile.contact_email || "");
    setPfState(profile.state || "");
    setPfPlatform(profile.platform || "playstation");
    setPfPsn(profile.psn_id || "");
    setPfXbox(profile.xbox_gamertag || "");
    setPfEa(profile.ea_account || "");
    setPfDob(profile.date_of_birth || "");
    setPfAff18(!!profile.affirmed_18_plus);
    if (profile.legal_name && !signedName.trim()) {
      setSignedName(profile.legal_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  async function saveEsportsProfile() {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const r = await fetch("/api/esports/player-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legal_name: pfLegalName.trim(),
          contact_email: pfEmail.trim(),
          state: pfState.trim(),
          platform: pfPlatform,
          psn_id: pfPlatform === "playstation" ? pfPsn.trim() : null,
          xbox_gamertag: pfPlatform === "xbox" ? pfXbox.trim() : null,
          ea_account: pfEa.trim() || null,
          date_of_birth: pfDob.trim() || null,
          affirmed_18_plus: pfAff18,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setProfileMsg(typeof j?.error === "string" ? j.error : "Could not save esports profile.");
        setProfileBusy(false);
        return;
      }
      setProfile((j?.profile as EsportsPlayerProfile | null) ?? null);
      setProfileMsg(null);
    } catch {
      setProfileMsg("Could not save esports profile.");
    }
    setProfileBusy(false);
  }

  async function submitConsent() {
    if (!profileReady) {
      setMsg("Complete your esports player profile before signing and paying.");
      return;
    }
    if (!consentReady || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/esports/tournament-registration/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_id: tournament.id,
          signed_full_name: signedName.trim(),
          confirmations: checks,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not save consent.");
        setBusy(false);
        return;
      }
      setRegistrationId(typeof j.registration_id === "string" ? j.registration_id : null);
      setPaymentStatus("unpaid");
      setMsg(null);
      await loadRegistration();
    } catch {
      setMsg("Something went wrong.");
    }
    setBusy(false);
  }

  async function startCheckout() {
    if (payBusy) return;
    setPayBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/esports/tournament-registration/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_id: tournament.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not start checkout.");
        setPayBusy(false);
        return;
      }
      if (j.checkout_url) {
        window.location.href = j.checkout_url;
        return;
      }
      setMsg("Checkout URL missing.");
    } catch {
      setMsg("Could not start checkout.");
    }
    setPayBusy(false);
  }

  if (authed === null) {
    return (
      <p className="text-sm text-white/60" role="status">
        Checking your session…
      </p>
    );
  }

  if (authed === false) {
    return (
      <p className="text-sm text-white/60" role="status">
        Redirecting to sign in…
      </p>
    );
  }

  if (paymentStatus === "paid") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--brand)]/35 bg-[var(--brand)]/10 px-4 py-3 text-sm text-white/90">
          You are registered and your entry fee is recorded for{" "}
          <span className="font-semibold text-white">{tournament.title}</span>.
        </div>
        <Link
          href={`/esports/tournaments/${tournament.id}`}
          className="inline-flex text-sm font-medium text-[var(--brand)] underline-offset-4 hover:underline"
        >
          Back to tournament overview
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {paidQuery ? (
        <p className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white/85">
          Payment received—thank you. If this page does not update within a minute, refresh.
        </p>
      ) : null}
      {canceledQuery ? (
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-50/95">
          Checkout was canceled. You can try again when you are ready.
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Tournament identity (Esports player profile)</h2>
        <p className="text-sm text-white/65">
          This is collected only when you register for tournaments. It is used for eligibility review,
          admin operations, and accurate bracket/participant identity.
        </p>

        {profileMsg ? <p className="text-sm text-red-300">{profileMsg}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              Platform
            </label>
            <select
              value={pfPlatform}
              onChange={(e) => setPfPlatform(e.target.value as any)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              disabled={profileBusy}
            >
              <option value="playstation">PlayStation</option>
              <option value="xbox">Xbox</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              State
            </label>
            <input
              value={pfState}
              onChange={(e) => setPfState(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              placeholder="e.g. NY"
              disabled={profileBusy}
              maxLength={32}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              Legal name
            </label>
            <input
              value={pfLegalName}
              onChange={(e) => setPfLegalName(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              placeholder="Full legal name"
              disabled={profileBusy}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              Contact email
            </label>
            <input
              value={pfEmail}
              onChange={(e) => setPfEmail(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              placeholder="you@email.com"
              disabled={profileBusy}
              inputMode="email"
              autoComplete="email"
            />
          </div>

          {pfPlatform === "playstation" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                PSN ID
              </label>
              <input
                value={pfPsn}
                onChange={(e) => setPfPsn(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
                placeholder="PlayStation Network ID"
                disabled={profileBusy}
              />
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Xbox gamertag
              </label>
              <input
                value={pfXbox}
                onChange={(e) => setPfXbox(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
                placeholder="Xbox gamertag"
                disabled={profileBusy}
              />
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              EA / FC account (optional)
            </label>
            <input
              value={pfEa}
              onChange={(e) => setPfEa(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              placeholder="EA account name / ID"
              disabled={profileBusy}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-start gap-3 text-sm leading-relaxed text-white/75">
              <input
                type="checkbox"
                checked={pfAff18}
                onChange={(e) => setPfAff18(e.target.checked)}
                disabled={profileBusy}
                className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-black"
              />
              <span>I confirm I am at least 18 years old.</span>
            </label>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Date of birth (optional)
              </label>
              <input
                type="date"
                value={pfDob}
                onChange={(e) => setPfDob(e.target.value)}
                disabled={profileBusy}
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <p className="text-xs text-white/45">
                Provide DOB if required for eligibility verification; otherwise 18+ confirmation is
                sufficient for this flow.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void saveEsportsProfile()}
            disabled={profileBusy}
            className="inline-flex items-center justify-center rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/35 hover:text-white disabled:opacity-40"
          >
            {profileBusy ? "Saving…" : profile ? "Update esports profile" : "Save esports profile"}
          </button>
          {profileReady ? (
            <span className="text-xs text-white/55">Profile complete.</span>
          ) : (
            <span className="text-xs text-white/55">Required before consent + payment.</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Read the documents</h2>
        <p className="text-sm text-white/65">
          These three documents work together: tournament-specific matters are governed by the Official
          Tournament Rules; privacy, publicity, and data use by the Privacy and Publicity Consent Policy;
          general platform and account matters by the Terms and Conditions. If there is a direct
          conflict, the more specific document controls. You must review each document before you sign.
          Versions on file: Rules {esportsDocVersionLabel.officialRules}, Terms{" "}
          {esportsDocVersionLabel.participantTerms}, Privacy {esportsDocVersionLabel.privacyPublicity}.
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <Link
              href={DOC_LINKS.rules}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
            >
              Official Tournament Rules
            </Link>
          </li>
          <li>
            <Link
              href={DOC_LINKS.terms}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
            >
              Terms and Conditions
            </Link>
          </li>
          <li>
            <Link
              href={DOC_LINKS.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
            >
              Privacy and Publicity Consent Policy
            </Link>
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Confirmations</h2>
        <ul className="space-y-3">
          {ESPORTS_CONFIRMATION_KEYS.map((key) => (
            <li key={key} className="flex gap-3">
              <input
                id={`chk-${key}`}
                type="checkbox"
                checked={checks[key]}
                onChange={(e) =>
                  setChecks((prev) => ({ ...prev, [key]: e.target.checked }))
                }
                className="mt-1 h-4 w-4 shrink-0 rounded border-white/25 bg-black/50"
              />
              <label htmlFor={`chk-${key}`} className="text-sm leading-relaxed text-white/80">
                {ESPORTS_CONFIRMATION_LABELS[key]}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <label htmlFor="esign" className="text-sm font-medium text-white/90">
          Electronic signature (type your full legal name)
        </label>
        <input
          id="esign"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
          placeholder="First and last name"
        />
        <p className="text-xs text-white/45">
          By typing your name, you adopt it as your electronic signature with the same effect as a
          handwritten signature, as of the time recorded on submission.
        </p>
      </section>

      {msg ? <p className="text-sm text-red-300">{msg}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => void submitConsent()}
          disabled={!profileReady || !consentReady || busy}
          className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save consent & continue"}
        </button>
        {registrationId && paymentStatus !== "paid" ? (
          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={payBusy}
            className="inline-flex items-center justify-center rounded-md border border-[var(--brand)]/50 bg-[var(--brand)]/15 px-5 py-3 text-sm font-semibold text-[var(--brand)] transition hover:bg-[var(--brand)]/25 disabled:opacity-40"
          >
            {payBusy ? "Starting checkout…" : "Pay $10 entry fee"}
          </button>
        ) : null}
      </div>

      {!registrationId && !consentReady ? (
        <p className="text-xs text-white/45">
          Complete every checkbox and your signature, then save consent to unlock payment.
        </p>
      ) : null}
    </div>
  );
}
