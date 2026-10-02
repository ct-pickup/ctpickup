"use client";

import Link from "next/link";
import { SupportEmailLink } from "@/components/SupportEmailLink";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HistoryBack } from "@/components/layout";
import { Input, selectFieldClassName } from "@/components/ui/input";
import {
  SIGNUP_INTENT_QUERY,
  SIGNUP_NEXT_QUERY,
  SIGNUP_GATE_QUERY,
  SIGNUP_GATE_VALUE_SIGNUP_FIRST,
  type SignupIntent,
  isSignupIntent,
  HAS_EVER_SIGNED_UP_KEY,
  signupCopyForIntent,
  signupUrlForIntent,
} from "@/lib/auth/signupIntent";
import { friendlySupabaseAuthMessage } from "@/lib/auth/friendlySupabaseAuthMessage";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { APP_HOME_FIRST_VISIT_URL } from "@/lib/siteNav";
import {
  isMissingProfileColumnError,
  profileSchemaMismatchUserMessage,
} from "@/lib/profileLoad";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import { useTransitionNav } from "@/components/TransitionNavContext";
import { EsportsGoaliePreferenceFields } from "@/components/profile/EsportsGoaliePreferenceFields";
import {
  bindEsportsPreferenceHandlers,
  esportsDetailsComplete,
  profileEsportsPreferenceColumns,
  type EsportsConsole,
  type EsportsInterest,
  type EsportsPlatform,
} from "@/lib/profilePreferences";
import {
  PROFILE_GENDER_LABELS,
  PROFILE_USERNAME_MAX_LEN,
  type ProfileGender,
  normalizeProfileUsername,
  USERNAME_TAKEN_USER_MESSAGE,
  profileIdentityColumns,
  normalizePlayingPosition,
} from "@/lib/profileIdentityFields";
import { Wordmark } from "@/components/brand/Wordmark";

type Stage = "email" | "code" | "profile";

/** Seconds to wait after a successful OTP send (Continue or Resend) before Resend is enabled again. */
const OTP_RESEND_COOLDOWN_SEC = 30;

const LEFT_IMAGE = "/signup/left.jpg";
const RIGHT_IMAGE = "/signup/right.jpg";

function cleanInstagramHandle(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

function SidePhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="hidden xl:block w-[280px]">
      <div className="overflow-hidden rounded-[30px] border border-line bg-overlay-subtle">
        <img
          src={src}
          alt={alt}
          className="h-[560px] w-full object-cover"
        />
      </div>
    </div>
  );
}

function StepBadge({
  number,
  label,
  active,
  done,
}: {
  number: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "relative flex h-9 w-9 items-center justify-center rounded-pill border text-small font-semibold transition-all duration-300",
          done
            ? "border-line bg-pitch text-on-pitch"
            : active
            ? "border-line bg-overlay text-ink"
            : "border-line bg-transparent text-muted",
        ].join("  ")}
      >
        {done ? "✓" : number}
      </div>

      <div className="flex flex-col">
        <span
          className={[
            "text-caption",
            active || done ? "text-ink" : "text-muted",
          ].join("  ")}
        >
          Step {number}
        </span>
        <span
          className={[
            "text-small font-medium",
            active ? "text-ink" : done ? "text-ink" : "text-muted",
          ].join("  ")}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <div className="group relative inline-flex">
      <div className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-pill border border-line text-caption font-semibold text-muted">
        i
      </div>

      <div className="pointer-events-none absolute left-7 top-1/2 z-20 hidden w-[280px] -translate-y-1/2 rounded-card border border-line bg-canvas px-3 py-2 text-caption leading-relaxed text-muted group-hover:block group-focus-within:block">
        We’ll only store your personal information once. If you run into issues,
        someone from CT Pickup may be able to help.
      </div>
    </div>
  );
}

function SignupForm({
  intent,
  showGateNotice,
  postSignupPath,
}: {
  intent: SignupIntent;
  showGateNotice?: boolean;
  /** Safe in-app path after signup, or null to use default first-visit home. */
  postSignupPath: string | null;
}) {
  const router = useRouter();
  const transitionNav = useTransitionNav();
  const { supabase, isReady } = useSupabaseBrowser();
  const copy = signupCopyForIntent(intent);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [msg, setMsg] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [sex, setSex] = useState<ProfileGender | "">("");
  const [gender, setGender] = useState<ProfileGender | "">("");
  const [genderOther, setGenderOther] = useState("");
  const [playingPosition, setPlayingPosition] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
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
    if (resendCooldownSec <= 0) return;
    const id = window.setTimeout(() => setResendCooldownSec((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldownSec]);

  const emailClean = useMemo(() => email.trim().toLowerCase(), [email]);

  const emailLooksValid = useMemo(() => {
    if (emailClean.length < 6) return false;
    if (!emailClean.includes("@")) return false;
    const [a, b] = emailClean.split("@");
    if (!a || !b) return false;
    if (!b.includes(".")) return false;
    return true;
  }, [emailClean]);

  const canContinueIdentity = useMemo(() => {
    return (
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      sex !== "" &&
      gender !== "" &&
      Boolean(normalizePlayingPosition(playingPosition))
    );
  }, [firstName, lastName, sex, gender, playingPosition]);

  const canContinueContact = useMemo(() => {
    return phone.trim().length > 0 && instagram.trim().length > 0;
  }, [phone, instagram]);

  const canSaveProfile = useMemo(() => {
    const userOk = Boolean(normalizeProfileUsername(username));
    const esportsOk =
      esportsInterest !== null &&
      esportsDetailsComplete({
        esports_interest: esportsInterest,
        esports_platform: esportsPlatform,
        esports_console: esportsConsole,
        esports_online_id: esportsOnlineId,
      });
    return (
      canContinueIdentity &&
      canContinueContact &&
      userOk &&
      esportsOk &&
      waiverAccepted
    );
  }, [
    canContinueIdentity,
    canContinueContact,
    username,
    esportsInterest,
    esportsPlatform,
    esportsConsole,
    esportsOnlineId,
    waiverAccepted,
  ]);

  async function checkExists() {
    const r = await fetch("/api/auth/email-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailClean }),
    });
    const j = await r.json();
    return !!j?.exists;
  }

  /** Shared `signInWithOtp` call (email step + resend). Caller must ensure `supabase` is ready. */
  function sendSignupOtp() {
    return supabase!.auth.signInWithOtp({
      email: emailClean,
      options: {
        emailRedirectTo: `${window.location.origin}${signupUrlForIntent(intent)}`,
      },
    });
  }

  async function sendCode() {
    if (!emailLooksValid || busy) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-up isn’t available right now (missing Supabase configuration).
            Please refresh, or email{"  "}
            <SupportEmailLink className="font-medium text-ink underline underline-offset-2 hover:text-ink" />{"  "}
            for help.
          </>,
        );
      }
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const exists = await checkExists();
      if (exists) {
        setMsg("You already have this account on file. Please log in with that email.");
        return;
      }

      const { error } = await sendSignupOtp();

      if (error) {
        setMsg(friendlySupabaseAuthMessage(error.message));
        return;
      }

      setStage("code");
      setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
      setMsg(null);
    } catch (e: unknown) {
      setMsg(
        e instanceof Error
          ? e.message
          : "Something went wrong while sending the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (!emailLooksValid || resendBusy || resendCooldownSec > 0) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-up isn’t available right now (missing Supabase configuration).
            Please refresh, or email{"  "}
            <SupportEmailLink className="font-medium text-ink underline underline-offset-2 hover:text-ink" />{"  "}
            for help.
          </>,
        );
      }
      return;
    }

    setResendBusy(true);
    setMsg(null);

    try {
      const { error } = await sendSignupOtp();

      if (error) {
        setMsg(friendlySupabaseAuthMessage(error.message));
        return;
      }

      setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
      setMsg("We sent a new 8-digit code to your email.");
    } catch (e: unknown) {
      setMsg(
        e instanceof Error
          ? e.message
          : "Something went wrong while sending the code. Please try again.",
      );
    } finally {
      setResendBusy(false);
    }
  }

  function goBackToEmail() {
    setStage("email");
    setCode("");
    setMsg(null);
    setResendCooldownSec(0);
  }

  async function verifyCode() {
    if (!code.trim() || busy) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-up isn’t available right now (missing Supabase configuration).
            Please refresh, or email{"  "}
            <SupportEmailLink className="font-medium text-ink underline underline-offset-2 hover:text-ink" />{"  "}
            for help.
          </>,
        );
      }
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const token = code.replace(/\D/g, "");
      if (token.length !== 8) {
        setMsg("Enter the 8-digit code from your email.");
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        email: emailClean,
        token,
        type: "email",
      });

      if (error) {
        setMsg(friendlySupabaseAuthMessage(error.message));
        return;
      }

      setStage("profile");
      setMsg(null);
    } catch (e: unknown) {
      setMsg(
        e instanceof Error
          ? e.message
          : "Something went wrong while verifying the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveProfileAndContinue() {
    if (!canSaveProfile || busy) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-up isn’t available right now (missing Supabase configuration).
            Please refresh, or email{"  "}
            <SupportEmailLink className="font-medium text-ink underline underline-offset-2 hover:text-ink" />{"  "}
            for help.
          </>,
        );
      }
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const user = auth.user;

      if (authErr || !user) {
        setBusy(false);
        setMsg("Session not found. Please verify your code again.");
        return;
      }

      const ig = cleanInstagramHandle(instagram);
      const profileEmail =
        (user.email ?? emailClean).trim().toLowerCase() || null;
      const nowIso = new Date().toISOString();

      const userNorm = normalizeProfileUsername(username);
      if (!userNorm) {
        setBusy(false);
        setMsg(
          `Username must be 3–${PROFILE_USERNAME_MAX_LEN} characters (lowercase letters and digits only).`,
        );
        return;
      }

      if (esportsInterest === null) {
        setBusy(false);
        setMsg("Answer the online tournament question.");
        return;
      }

      const prefs = profileEsportsPreferenceColumns({
        esportsInterest,
        esportsPlatform,
        esportsConsole,
        esportsOnlineId,
      });

      const identity = profileIdentityColumns({
        firstName,
        lastName,
        sex: sex as ProfileGender,
        gender: gender as ProfileGender,
        genderOther,
        playingPosition,
      });

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          email: profileEmail,
          first_name: identity.first_name,
          last_name: identity.last_name,
          sex: identity.sex,
          gender: identity.gender,
          gender_other: identity.gender_other,
          playing_position: identity.playing_position,
          username: userNorm,
          phone: phone.trim(),
          instagram: ig,
          esports_interest: prefs.esports_interest,
          esports_platform: prefs.esports_platform,
          esports_console: prefs.esports_console,
          esports_online_id: prefs.esports_online_id,
          updated_at: nowIso,
        },
        { onConflict: "id" }
      );

      if (error) {
        console.error("[signup] profiles upsert failed:", error.message, error);
        if (isMissingProfileColumnError(error.message)) {
          console.error("[signup] Apply profile migrations (see profileSchemaMismatchUserMessage in lib/profileLoad.ts).");
        }
        setBusy(false);
        const code = (error as { code?: string }).code;
        const dup =
          code === "23505" ||
          /profiles_username_lower_unique|duplicate key/i.test(error.message ?? "");
        setMsg(
          dup
            ? USERNAME_TAKEN_USER_MESSAGE
            : isMissingProfileColumnError(error.message)
              ? profileSchemaMismatchUserMessage()
              : error.message,
        );
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setBusy(false);
        setMsg("Session not found. Please verify your code again.");
        return;
      }

      const acceptRes = await fetch("/api/waiver/accept", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ acknowledge: true }),
      });

      setBusy(false);
      if (!acceptRes.ok) {
        const aj = await acceptRes.json().catch(() => ({}));
        setMsg(
          typeof aj?.error === "string"
            ? `Could not record waiver acceptance (${aj.error.replace(/_/g, " ")}).`
            : "Could not record waiver acceptance. Please try again."
        );
        return;
      }

      try {
        window.localStorage.setItem(HAS_EVER_SIGNED_UP_KEY, "1");
      } catch {
        /* ignore */
      }

      const destination = postSignupPath ?? APP_HOME_FIRST_VISIT_URL;
      setTransitioning(true);
      setTimeout(() => {
        if (transitionNav) {
          transitionNav.navigateWithTransition(destination);
        } else {
          router.push(destination);
        }
      }, 260);
    } catch (e: unknown) {
      setBusy(false);
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const currentStep = stage === "email" ? 1 : stage === "code" ? 2 : 3;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div
        className={[
          "fixed inset-0 bg-canvas pointer-events-none transition-opacity duration-300",
          transitioning ? "opacity-100" : "opacity-0",
        ].join("  ")}
      />

      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <Wordmark as="div" className="text-body text-ink md:text-h3" />

          <HistoryBack
            fallbackHref="/"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-muted underline-offset-4 transition hover:text-ink hover:underline"
          />
        </div>

        <div className="flex items-center justify-center gap-10">
          <SidePhoto src={LEFT_IMAGE} alt="CT Pickup left" />

          <div className="w-full max-w-[420px]">
            <div className="rounded-[30px] border border-line bg-card p-5 md:p-6">
              {showGateNotice ? (
                <p
                  role="status"
                  className="mb-5 rounded-card border border-line bg-card px-4 py-3 text-small leading-relaxed text-ink"
                >
                  You must sign up first to get access.
                </p>
              ) : null}
              <div className="space-y-3">
                <h1 className="text-display font-serif md:text-display font-semibold">
                  {copy.title}
                </h1>

                <p className="text-small md:text-body text-muted leading-relaxed">{copy.lead}</p>

                <p className="text-small text-muted leading-relaxed">
                  We’ll email you an 8-digit verification code, so no password is needed. Use
                  your primary email.
                </p>

                <div className="pt-1">
                  <InfoIcon />
                </div>
              </div>

              <div className="mt-7 rounded-card border border-line bg-card px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StepBadge number={1} label="Email" active={currentStep === 1} done={currentStep > 1} />
                  <StepBadge number={2} label="Verify" active={currentStep === 2} done={currentStep > 2} />
                  <StepBadge number={3} label="Profile" active={currentStep === 3} done={false} />
                </div>
              </div>

              <div className="mt-6 rounded-card border border-line bg-card p-5 space-y-4">
                {stage === "email" && (
                  <>
                    <Input
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      inputMode="email"
                      autoComplete="email"
                    />

                    <button
                      type="button"
                      className="w-full rounded-card bg-pitch px-4 py-3.5 text-small font-semibold text-on-pitch disabled:opacity-50"
                      onClick={() => void sendCode()}
                      disabled={!emailLooksValid || busy || !isReady}
                    >
                      {busy ? "Continuing..." : !isReady ? "Loading…" : "Continue"}
                    </button>
                  </>
                )}

                {stage === "code" && (
                  <>
                    <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 text-small">
                      <span className="min-w-0 truncate text-ink" title={emailClean}>
                        {emailClean}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-medium text-ink underline underline-offset-4 transition hover:text-ink disabled:opacity-50"
                        onClick={goBackToEmail}
                        disabled={busy || resendBusy}
                      >
                        Change email
                      </button>
                    </div>

                    <p
                      role="status"
                      className="text-small text-ink leading-relaxed"
                    >
                      We sent an 8-digit code to your email. Enter it below to continue.
                    </p>
                    <Input
                      placeholder="8-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={busy || resendBusy}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={16}
                      aria-describedby="signup-code-hint"
                    />
                    <p id="signup-code-hint" className="text-caption text-muted">
                      Enter the 8-digit code from your email (spaces are OK).
                    </p>

                    <button
                      type="button"
                      className="w-full rounded-card bg-pitch px-4 py-3.5 text-small font-semibold text-on-pitch disabled:opacity-50"
                      onClick={() => void verifyCode()}
                      disabled={!code.trim() || busy || !isReady}
                    >
                      {busy ? "Verifying..." : !isReady ? "Loading…" : "Continue"}
                    </button>

                    {resendCooldownSec > 0 ? (
                      <p className="text-center text-caption text-muted">
                        Resend code in {resendCooldownSec}s
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="w-full rounded-card border border-line bg-canvas px-4 py-3.5 text-small font-medium text-ink hover:bg-overlay-subtle disabled:opacity-50"
                        onClick={() => void resendCode()}
                        disabled={resendBusy || busy || !isReady}
                      >
                        {resendBusy ? "Sending..." : !isReady ? "Loading…" : "Resend code"}
                      </button>
                    )}
                  </>
                )}

                {stage === "profile" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        placeholder="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={busy}
                        autoComplete="given-name"
                      />

                      <Input
                        placeholder="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={busy}
                        autoComplete="family-name"
                      />
                    </div>

                    <div className="w-full">
                      <label className="mb-2 block text-caption font-semibold text-muted">
                        Sex
                      </label>
                      <select
                        className={selectFieldClassName}
                        value={sex}
                        onChange={(e) => setSex(e.target.value as ProfileGender)}
                        disabled={busy}
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        <option value="male">{PROFILE_GENDER_LABELS.male}</option>
                        <option value="female">{PROFILE_GENDER_LABELS.female}</option>
                        <option value="other">{PROFILE_GENDER_LABELS.other}</option>
                      </select>
                    </div>

                    <div className="w-full">
                      <label className="mb-2 block text-caption font-semibold text-muted">
                        Gender
                      </label>
                      <select
                        className={selectFieldClassName}
                        value={gender}
                        onChange={(e) => setGender(e.target.value as ProfileGender)}
                        disabled={busy}
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
                      <Input
                        placeholder="Describe (optional)"
                        value={genderOther}
                        onChange={(e) => setGenderOther(e.target.value)}
                        disabled={busy}
                        maxLength={64}
                      />
                    ) : null}

                    <Input
                      placeholder="Playing position"
                      value={playingPosition}
                      onChange={(e) => setPlayingPosition(e.target.value)}
                      disabled={busy}
                    />

                    <EsportsGoaliePreferenceFields
                      variant="signup"
                      esportsInterest={esportsInterest}
                      onEsportsInterest={onEsportsInterest}
                      esportsPlatform={esportsPlatform}
                      onEsportsPlatform={onEsportsPlatform}
                      esportsConsole={esportsConsole}
                      onEsportsConsole={setEsportsConsole}
                      esportsOnlineId={esportsOnlineId}
                      onEsportsOnlineIdChange={setEsportsOnlineId}
                      disabled={busy}
                    />

                    <Input
                      placeholder={`Username (${PROFILE_USERNAME_MAX_LEN} chars max, a–z, 0–9)`}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy}
                      autoComplete="username"
                      maxLength={PROFILE_USERNAME_MAX_LEN}
                    />

                    <Input
                      placeholder="Phone Number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={busy}
                      inputMode="tel"
                      autoComplete="tel"
                    />

                    <Input
                      placeholder="Instagram Handle"
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      disabled={busy}
                    />

                    <label className="flex cursor-pointer items-start gap-3 text-left text-small leading-relaxed text-muted">
                      <input
                        type="checkbox"
                        checked={waiverAccepted}
                        onChange={(e) => setWaiverAccepted(e.target.checked)}
                        disabled={busy}
                        className="mt-1 h-4 w-4 shrink-0 rounded-button border-line bg-canvas"
                      />
                      <span>
                        I agree to the{"  "}
                        <Link
                          href={`/liability-waiver?returnTo=${encodeURIComponent(signupUrlForIntent(intent))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          Liability Waiver &amp; Participation Agreement
                        </Link>{"  "}
                        ({CURRENT_WAIVER_VERSION}), including eligibility (13+; parental
                        consent if under 18). I understand I must accept the current waiver
                        version to use tournaments and related services.
                      </span>
                    </label>

                    <button
                      type="button"
                      className="w-full rounded-card bg-pitch px-4 py-3.5 text-small font-semibold text-on-pitch disabled:opacity-50"
                      onClick={() => void saveProfileAndContinue()}
                      disabled={!canSaveProfile || busy || !isReady}
                    >
                      {busy ? "Saving..." : !isReady ? "Loading…" : copy.finishCta}
                    </button>
                  </>
                )}

                {msg ? (
                  <p className="text-small text-muted whitespace-pre-line leading-relaxed">{msg}</p>
                ) : null}

                {typeof msg === "string" && msg.includes("already have this account") && (
                  <Link
                    href="/login"
                    className="block text-small text-muted hover:text-ink hover:underline underline-offset-4"
                  >
                    Go to log in
                  </Link>
                )}
              </div>
            </div>
          </div>

          <SidePhoto src={RIGHT_IMAGE} alt="CT Pickup right" />
        </div>
      </div>
    </main>
  );
}

function SignupGate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get(SIGNUP_INTENT_QUERY);
  const intent = isSignupIntent(raw) ? raw : null;
  const showGateNotice = searchParams.get(SIGNUP_GATE_QUERY) === SIGNUP_GATE_VALUE_SIGNUP_FIRST;
  const postSignupPath = safeNextPath(searchParams.get(SIGNUP_NEXT_QUERY));

  useEffect(() => {
    if (intent === null) {
      router.replace("/");
    }
  }, [intent, router]);

  if (intent === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas text-small text-muted">
        Returning to home…
      </main>
    );
  }

  return (
    <SignupForm intent={intent} showGateNotice={showGateNotice} postSignupPath={postSignupPath} />
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-canvas text-small text-muted">
          Loading…
        </main>
      }
    >
      <SignupGate />
    </Suspense>
  );
}