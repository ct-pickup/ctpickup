"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SupportEmailLink } from "@/components/SupportEmailLink";
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

const US_STATE_OPTIONS = [
  { value: "", label: "Select…" },
  { value: "AL", label: "AL — Alabama" },
  { value: "AK", label: "AK — Alaska" },
  { value: "AZ", label: "AZ — Arizona" },
  { value: "AR", label: "AR — Arkansas" },
  { value: "CA", label: "CA — California" },
  { value: "CO", label: "CO — Colorado" },
  { value: "CT", label: "CT — Connecticut" },
  { value: "DE", label: "DE — Delaware" },
  { value: "DC", label: "DC — District of Columbia" },
  { value: "FL", label: "FL — Florida" },
  { value: "GA", label: "GA — Georgia" },
  { value: "HI", label: "HI — Hawaii" },
  { value: "ID", label: "ID — Idaho" },
  { value: "IL", label: "IL — Illinois" },
  { value: "IN", label: "IN — Indiana" },
  { value: "IA", label: "IA — Iowa" },
  { value: "KS", label: "KS — Kansas" },
  { value: "KY", label: "KY — Kentucky" },
  { value: "LA", label: "LA — Louisiana" },
  { value: "ME", label: "ME — Maine" },
  { value: "MD", label: "MD — Maryland" },
  { value: "MA", label: "MA — Massachusetts" },
  { value: "MI", label: "MI — Michigan" },
  { value: "MN", label: "MN — Minnesota" },
  { value: "MS", label: "MS — Mississippi" },
  { value: "MO", label: "MO — Missouri" },
  { value: "MT", label: "MT — Montana" },
  { value: "NE", label: "NE — Nebraska" },
  { value: "NV", label: "NV — Nevada" },
  { value: "NH", label: "NH — New Hampshire" },
  { value: "NJ", label: "NJ — New Jersey" },
  { value: "NM", label: "NM — New Mexico" },
  { value: "NY", label: "NY — New York" },
  { value: "NC", label: "NC — North Carolina" },
  { value: "ND", label: "ND — North Dakota" },
  { value: "OH", label: "OH — Ohio" },
  { value: "OK", label: "OK — Oklahoma" },
  { value: "OR", label: "OR — Oregon" },
  { value: "PA", label: "PA — Pennsylvania" },
  { value: "RI", label: "RI — Rhode Island" },
  { value: "SC", label: "SC — South Carolina" },
  { value: "SD", label: "SD — South Dakota" },
  { value: "TN", label: "TN — Tennessee" },
  { value: "TX", label: "TX — Texas" },
  { value: "UT", label: "UT — Utah" },
  { value: "VT", label: "VT — Vermont" },
  { value: "VA", label: "VA — Virginia" },
  { value: "WA", label: "WA — Washington" },
  { value: "WV", label: "WV — West Virginia" },
  { value: "WI", label: "WI — Wisconsin" },
  { value: "WY", label: "WY — Wyoming" },
] as const;

function normStateCode(s: string): string {
  return String(s || "").trim().toUpperCase();
}

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
    if (normStateCode(profile.state) === "CT") return false;
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

  const stateBlocked = useMemo(() => normStateCode(pfState) === "CT", [pfState]);

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
    if (stateBlocked) {
      setProfileMsg("No CT residents are allowed.");
      return;
    }
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
      <p className="text-small text-muted" role="status">
        Checking your session…
      </p>
    );
  }

  if (authed === false) {
    return (
      <p className="text-small text-muted" role="status">
        Redirecting to sign in…
      </p>
    );
  }

  if (paymentStatus === "paid") {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-[var(--brand)]/35 bg-[var(--brand)]/10 px-4 py-3 text-small text-ink">
          You are registered and your entry fee is recorded for{"  "}
          <span className="font-semibold text-ink">{tournament.title}</span>.
        </div>
        <p className="text-caption leading-relaxed text-muted">
          Important tournament details—including opponent and group-stage information—may be sent by text
          to the mobile number on your account. Check your messages and keep your profile phone number
          current.
        </p>
        <p className="text-caption leading-relaxed text-muted">
          Refunds: request more than 48 hours before start (see{"  "}
          <Link
            href={`${DOC_LINKS.rules}#refund-policy`}
            className="font-medium text-pitch-text underline-offset-4 hover:underline"
          >
            Official Tournament Rules §9
          </Link>
          ). Questions:{"  "}
          <SupportEmailLink className="font-medium text-pitch-text underline-offset-4 hover:underline" />.
        </p>
        <Link
          href={`/esports/tournaments/${tournament.id}`}
          className="inline-flex text-small font-medium text-pitch-text underline-offset-4 hover:underline"
        >
          Back to tournament overview
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {paidQuery ? (
        <div className="space-y-2 rounded-card border border-line bg-card px-4 py-3 text-small text-ink">
          <p>Payment received—thank you. If this page does not update within a minute, refresh.</p>
          <p className="text-caption text-muted">
            Watch for tournament texts to your profile mobile number (opponents, group stage, schedule
            updates, and other logistics).
          </p>
          <p className="text-caption text-muted">
            Refund rules (48-hour request window, organizer cancel, etc.):{"  "}
            <Link
              href={`${DOC_LINKS.rules}#refund-policy`}
              className="font-medium text-pitch-text underline-offset-4 hover:underline"
            >
              Official Tournament Rules §§8–9
            </Link>
            .
          </p>
        </div>
      ) : null}
      {canceledQuery ? (
        <p className="rounded-card border border-line bg-card px-4 py-3 text-small text-ink">
          Checkout was canceled. You can try again when you are ready.
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-h3 font-serif font-semibold text-ink">Tournament identity (Esports player profile)</h2>
        <p className="text-small text-muted">
          This is collected only when you register for tournaments. It is used for eligibility review,
          admin operations, and accurate bracket/participant identity.
        </p>

        {profileMsg ? <p className="text-small text-coral-text">{profileMsg}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-caption font-semibold text-muted">
              Platform
            </label>
            <select
              value={pfPlatform}
              onChange={(e) => setPfPlatform(e.target.value as any)}
              className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              disabled={profileBusy}
            >
              <option value="playstation">PlayStation</option>
              <option value="xbox">Xbox</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-caption font-semibold text-muted">
              State
            </label>
            <select
              value={normStateCode(pfState)}
              onChange={(e) => {
                setProfileMsg(null);
                setPfState(e.target.value);
              }}
              className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              disabled={profileBusy}
            >
              {US_STATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.value === ""}>
                  {opt.label}
                </option>
              ))}
            </select>
            {stateBlocked ? (
              <p className="text-caption text-coral-text">No CT residents are allowed.</p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-caption font-semibold text-muted">
              Legal name
            </label>
            <input
              value={pfLegalName}
              onChange={(e) => setPfLegalName(e.target.value)}
              className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
              placeholder="Full legal name"
              disabled={profileBusy}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-caption font-semibold text-muted">
              Contact email
            </label>
            <input
              value={pfEmail}
              onChange={(e) => setPfEmail(e.target.value)}
              className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
              placeholder="you@email.com"
              disabled={profileBusy}
              inputMode="email"
              autoComplete="email"
            />
          </div>

          {pfPlatform === "playstation" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-caption font-semibold text-muted">
                PSN ID
              </label>
              <input
                value={pfPsn}
                onChange={(e) => setPfPsn(e.target.value)}
                className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
                placeholder="PlayStation Network ID"
                disabled={profileBusy}
              />
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-caption font-semibold text-muted">
                Xbox gamertag
              </label>
              <input
                value={pfXbox}
                onChange={(e) => setPfXbox(e.target.value)}
                className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
                placeholder="Xbox gamertag"
                disabled={profileBusy}
              />
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-caption font-semibold text-muted">
              EA / FC account (optional)
            </label>
            <input
              value={pfEa}
              onChange={(e) => setPfEa(e.target.value)}
              className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
              placeholder="EA account name / ID"
              disabled={profileBusy}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-start gap-3 text-small leading-relaxed text-muted">
              <input
                type="checkbox"
                checked={pfAff18}
                onChange={(e) => setPfAff18(e.target.checked)}
                disabled={profileBusy}
                className="mt-1 h-4 w-4 shrink-0 rounded-button border-line bg-canvas"
              />
              <span>I confirm I am at least 18 years old.</span>
            </label>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-muted">
                Date of birth (optional)
              </label>
              <input
                type="date"
                value={pfDob}
                onChange={(e) => setPfDob(e.target.value)}
                disabled={profileBusy}
                className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              />
              <p className="text-caption text-muted">
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
            disabled={profileBusy || stateBlocked}
            className="inline-flex items-center justify-center rounded-button border border-line px-5 py-3 text-small font-semibold text-ink transition hover:border-line hover:text-ink disabled:opacity-40"
          >
            {profileBusy ? "Saving…" : profile ? "Update esports profile" : "Save esports profile"}
          </button>
          {profileReady ? (
            <span className="text-caption text-muted">Profile complete.</span>
          ) : (
            <span className="text-caption text-muted">Required before consent + payment.</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-h3 font-serif font-semibold text-ink">Read the documents</h2>
        <p className="text-small text-muted">
          These three documents work together: tournament-specific matters are governed by the Official
          Tournament Rules; privacy, publicity, and data use by the Privacy and Publicity Consent Policy;
          general platform and account matters by the Terms and Conditions. If there is a direct
          conflict, the more specific document controls. You must review each document before you sign.
          Versions on file: Rules {esportsDocVersionLabel.officialRules}, Terms{"  "}
          {esportsDocVersionLabel.participantTerms}, Privacy {esportsDocVersionLabel.privacyPublicity}.
        </p>
        <ul className="flex flex-col gap-2 text-small">
          <li>
            <Link
              href={DOC_LINKS.rules}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-pitch-text underline-offset-4 hover:underline"
            >
              Official Tournament Rules
            </Link>
          </li>
          <li>
            <Link
              href={DOC_LINKS.terms}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-pitch-text underline-offset-4 hover:underline"
            >
              Terms and Conditions
            </Link>
          </li>
          <li>
            <Link
              href={DOC_LINKS.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-pitch-text underline-offset-4 hover:underline"
            >
              Privacy and Publicity Consent Policy
            </Link>
          </li>
        </ul>
      </section>

      <section
        className="space-y-2 rounded-card border border-line bg-card px-4 py-3"
        aria-labelledby="esports-refund-heading"
      >
        <h2 id="esports-refund-heading" className="text-small font-semibold text-ink">
          Entry fee &amp; refunds
        </h2>
        <p className="text-small leading-relaxed text-muted">
          You may request a refund of the $10 fee if you email{"  "}
          <SupportEmailLink className="font-medium text-pitch-text underline-offset-4 hover:underline" />{"  "}
          more than 48 hours before the published tournament start time. Refund requests within 48 hours of
          the start time are not refunded. No-shows and disqualifications are not refunded. If the Organizer
          cancels before any matches are played, entry fees are refunded. If the event is rescheduled but
          not canceled, your registration usually carries over. Verified duplicate or mistaken charges:
          email{"  "}
          <SupportEmailLink className="font-medium text-pitch-text underline-offset-4 hover:underline" />
          . Full details:{"  "}
          <Link
            href={`${DOC_LINKS.rules}#refund-policy`}
            className="font-medium text-pitch-text underline-offset-4 hover:underline"
          >
            Refund Policy (Official Tournament Rules §§8–9)
          </Link>
          .
        </p>
      </section>

      <section
        className="space-y-2 rounded-card border border-line bg-card px-4 py-3"
        aria-labelledby="esports-sms-notice-heading"
      >
        <h2 id="esports-sms-notice-heading" className="text-small font-semibold text-ink">
          Tournament text messages
        </h2>
        <p className="text-small leading-relaxed text-muted">
          By registering, you agree that we may send tournament-related text messages to the mobile number
          on your CT Pickup account. These messages can include group-stage assignments, opponent
          information, match times, schedule updates, check-in reminders, reporting instructions, and other
          key logistics—sometimes in addition to or instead of the website. They are for running the
          tournament, not marketing. Message and data rates may apply. Details:{"  "}
          <Link
            href={`${DOC_LINKS.rules}#tournament-related-sms`}
            className="font-medium text-pitch-text underline-offset-4 hover:underline"
          >
            Official Tournament Rules §4.4
          </Link>
          .
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-h3 font-serif font-semibold text-ink">Confirmations</h2>
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
                className="mt-1 h-4 w-4 shrink-0 rounded-button border-line bg-overlay-subtle"
              />
              <label htmlFor={`chk-${key}`} className="text-small leading-relaxed text-ink">
                {ESPORTS_CONFIRMATION_LABELS[key]}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <label htmlFor="esign" className="text-small font-medium text-ink">
          Electronic signature (type your full legal name)
        </label>
        <input
          id="esign"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink placeholder:text-muted"
          placeholder="First and last name"
        />
        <p className="text-caption text-muted">
          By typing your name, you adopt it as your electronic signature with the same effect as a
          handwritten signature, as of the time recorded on submission.
        </p>
      </section>

      {msg ? <p className="text-small text-coral-text">{msg}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => void submitConsent()}
          disabled={!profileReady || !consentReady || busy}
          className="inline-flex items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save consent & continue"}
        </button>
        {registrationId && paymentStatus !== "paid" ? (
          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={payBusy}
            className="inline-flex items-center justify-center rounded-button border border-[var(--brand)]/50 bg-[var(--brand)]/15 px-5 py-3 text-small font-semibold text-pitch-text transition hover:bg-[var(--brand)]/25 disabled:opacity-40"
          >
            {payBusy ? "Starting checkout…" : "Pay $10 entry fee"}
          </button>
        ) : null}
      </div>

      {!registrationId && !consentReady ? (
        <p className="text-caption text-muted">
          Complete every checkbox and your signature, then save consent to unlock payment.
        </p>
      ) : null}
    </div>
  );
}
