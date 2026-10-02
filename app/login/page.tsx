"use client";

import Link from "next/link";
import { HistoryBack } from "@/components/layout";
import { friendlySupabaseAuthMessage } from "@/lib/auth/friendlySupabaseAuthMessage";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { signupUrlForIntent } from "@/lib/auth/signupIntent";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useTransitionNav } from "@/components/TransitionNavContext";
import { SupportEmailLink } from "@/components/SupportEmailLink";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const OTP_RESEND_COOLDOWN_SEC = 30;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transitionNav = useTransitionNav();
  const { supabase, isReady } = useSupabaseBrowser();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

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

  async function checkExists() {
    const r = await fetch("/api/auth/email-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailClean }),
    });
    const j = await r.json();
    return !!j?.exists;
  }

  async function sendCode() {
    if (!emailLooksValid || busy) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-in isn’t available right now (missing Supabase configuration).
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

    const exists = await checkExists();
    if (!exists) {
      setBusy(false);
      setMsg("No account on file for this email. Please create an account first.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: {
        emailRedirectTo: `${window.location.origin}${APP_HOME_URL}`,
      },
    });

    setBusy(false);
    if (error) return setMsg(friendlySupabaseAuthMessage(error.message));

    setStage("code");
    setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
    setMsg(null);
  }

  async function resendCode() {
    if (!emailLooksValid || resendBusy || resendCooldownSec > 0) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          <>
            Sign-in isn’t available right now (missing Supabase configuration).
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

    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: {
        emailRedirectTo: `${window.location.origin}${APP_HOME_URL}`,
      },
    });

    setResendBusy(false);
    if (error) return setMsg(friendlySupabaseAuthMessage(error.message));

    setResendCooldownSec(OTP_RESEND_COOLDOWN_SEC);
    setMsg("We sent a new code");
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
            Sign-in isn’t available right now (missing Supabase configuration).
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

    const token = code.replace(/\D/g, "");
    if (token.length !== 8) {
      setBusy(false);
      setMsg("Enter the 8-digit code from your email.");
      return;
    }

    const { error } = await supabase.auth.verifyOtp({
      email: emailClean,
      token,
      type: "email",
    });

    setBusy(false);
    if (error) return setMsg(friendlySupabaseAuthMessage(error.message));

    const next = safeNextPath(searchParams.get("next"));
    const target = next ?? APP_HOME_URL;

    setTransitioning(true);
    setTimeout(() => {
      if (transitionNav) {
        transitionNav.navigateWithTransition(target);
      } else {
        router.push(target);
      }
    }, 260);
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div
        className={[
          "fixed inset-0 bg-canvas pointer-events-none transition-opacity duration-300",
          transitioning ? "opacity-100" : "opacity-0",
        ].join("  ")}
      />

      <div className="mx-auto max-w-md px-6 py-14 space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-h1 font-serif font-semibold">LOG IN</h1>
            <p className="text-small text-muted">Log in to save your info and manage invites.</p>
            <p className="text-small text-muted">
              We’ll email you an 8-digit verification code. No password needed.
            </p>
          </div>

          <HistoryBack
            fallbackHref="/"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-muted underline-offset-4 transition hover:text-ink hover:underline"
          />
        </div>

        <div className="rounded-card border border-line bg-overlay-subtle p-6 space-y-4">
          <div className="space-y-2">
            {stage === "email" ? (
              <>
                <input
                  className="w-full rounded-card border border-line bg-canvas px-4 py-3 text-small text-ink placeholder:text-muted outline-none focus:border-line"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  inputMode="email"
                  autoComplete="email"
                />
                <div className="text-caption text-muted">We’ll never share your email.</div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-overlay-subtle px-4 py-3 text-small">
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
            )}
          </div>

          {stage === "email" ? (
            <button
              type="button"
              className="w-full rounded-card bg-pitch px-4 py-3 text-small font-semibold text-on-pitch disabled:opacity-50"
              onClick={() => void sendCode()}
              disabled={!emailLooksValid || busy || !isReady}
            >
              {busy ? "Continuing..." : !isReady ? "Loading…" : "Continue"}
            </button>
          ) : (
            <>
              <p role="status" className="text-small text-ink leading-relaxed">
                We sent an 8-digit code to your email. Enter it below to continue.
              </p>
              <input
                className="w-full rounded-card border border-line bg-canvas px-4 py-3 text-small text-ink placeholder:text-muted outline-none focus:border-line"
                placeholder="8-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={16}
                aria-describedby="login-code-hint"
              />
              <p id="login-code-hint" className="text-caption text-muted">
                Enter the 8-digit code from your email (spaces are OK).
              </p>

              <button
                type="button"
                className="w-full rounded-card bg-pitch px-4 py-3 text-small font-semibold text-on-pitch disabled:opacity-50"
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
                  className="w-full rounded-card border border-line bg-canvas px-4 py-3 text-small font-medium text-ink hover:bg-overlay-subtle disabled:opacity-50"
                  onClick={() => void resendCode()}
                  disabled={resendBusy || busy || !isReady}
                >
                  {resendBusy ? "Sending..." : !isReady ? "Loading…" : "Resend code"}
                </button>
              )}
            </>
          )}

          {msg ? <p className="text-small text-muted">{msg}</p> : null}

          {typeof msg === "string" && msg.includes("No account on file") && (
            <div className="space-y-2 text-small text-muted">
              <p className="text-muted">Create an account when you are joining:</p>
              <Link
                href={signupUrlForIntent("pickup")}
                className="block hover:text-ink hover:underline underline-offset-4"
              >
                Join Pickup (sign up)
              </Link>
              <Link
                href={signupUrlForIntent("tournament")}
                className="block hover:text-ink hover:underline underline-offset-4"
              >
                Join Tournament (sign up)
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas text-ink flex items-center justify-center text-small text-muted">
          Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
