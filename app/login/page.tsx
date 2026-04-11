"use client";

import Link from "next/link";
import { HistoryBack } from "@/components/layout";
import { friendlySupabaseAuthMessage } from "@/lib/auth/friendlySupabaseAuthMessage";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { signupUrlForIntent } from "@/lib/auth/signupIntent";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useTransitionNav } from "@/components/TransitionNavContext";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transitionNav = useTransitionNav();
  const { supabase, isReady } = useSupabaseBrowser();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

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
          "Sign-in isn’t available right now (missing Supabase configuration). Please refresh or contact support.",
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
    setMsg("Code sent. Check your email for an 8-digit code.");
  }

  async function verifyCode() {
    if (!code.trim() || busy) return;
    if (!isReady || !supabase) {
      if (!isReady) {
        setMsg("Still connecting. Please try again in a moment.");
      } else {
        setMsg(
          "Sign-in isn’t available right now (missing Supabase configuration). Please refresh or contact support.",
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
    <main className="min-h-screen bg-black text-white">
      <div
        className={[
          "fixed inset-0 bg-black pointer-events-none transition-opacity duration-300",
          transitioning ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      <div className="mx-auto max-w-md px-6 py-14 space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold uppercase tracking-tight">LOG IN</h1>
            <p className="text-sm text-white/75">Log in to save your info and manage invites.</p>
            <p className="text-sm text-white/55">
              We’ll email you an 8-digit verification code. No password needed.
            </p>
          </div>

          <HistoryBack
            fallbackHref="/"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-white/70 underline-offset-4 transition hover:text-white hover:underline"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <div className="space-y-2">
            <input
              className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={stage === "code" || busy}
              inputMode="email"
              autoComplete="email"
            />
            {stage === "email" && (
              <div className="text-xs text-white/45">We’ll never share your email.</div>
            )}
          </div>

          {stage === "email" ? (
            <button
              type="button"
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
              onClick={() => void sendCode()}
              disabled={!emailLooksValid || busy || !isReady}
            >
              {busy ? "Continuing..." : !isReady ? "Loading…" : "Continue"}
            </button>
          ) : (
            <>
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                placeholder="8-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={16}
                aria-describedby="login-code-hint"
              />
              <p id="login-code-hint" className="text-xs text-white/45">
                Enter the 8-digit code from your email (spaces are OK).
              </p>

              <button
                type="button"
                className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                onClick={() => void verifyCode()}
                disabled={!code.trim() || busy || !isReady}
              >
                {busy ? "Verifying..." : !isReady ? "Loading…" : "Continue"}
              </button>

              <button
                type="button"
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white/85 hover:bg-white/[0.04]"
                onClick={() => {
                  setStage("email");
                  setCode("");
                  setMsg(null);
                }}
                disabled={busy}
              >
                Back
              </button>
            </>
          )}

          {msg ? <p className="text-sm text-white/70">{msg}</p> : null}

          {msg?.includes("No account on file") && (
            <div className="space-y-2 text-sm text-white/70">
              <p className="text-white/55">Create an account when you are joining:</p>
              <Link
                href={signupUrlForIntent("pickup")}
                className="block hover:text-white hover:underline underline-offset-4"
              >
                Join Pickup (sign up)
              </Link>
              <Link
                href={signupUrlForIntent("tournament")}
                className="block hover:text-white hover:underline underline-offset-4"
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
        <main className="min-h-screen bg-black text-white flex items-center justify-center text-sm text-white/60">
          Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
