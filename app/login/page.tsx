"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const router = useRouter();

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
      options: { emailRedirectTo: `${window.location.origin}/after-login` },
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    setStage("code");
    setMsg("Code sent. Check your email.");
  }

  async function verifyCode() {
    if (!code.trim() || busy) return;

    setBusy(true);
    setMsg(null);

    const { error } = await supabase.auth.verifyOtp({
      email: emailClean,
      token: code.trim(),
      type: "email",
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    // smooth fade out
    setTransitioning(true);
    setTimeout(() => router.push("/after-login"), 260);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Fade overlay */}
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
            <p className="text-sm text-white/55">We’ll email you a verification code. No password needed.</p>
          </div>

          <Link
            href="/"
            className="text-sm text-white/70 hover:underline underline-offset-4 hover:text-white"
          >
            Back
          </Link>
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
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
              onClick={sendCode}
              disabled={!emailLooksValid || busy}
            >
              {busy ? "Continuing..." : "Continue"}
            </button>
          ) : (
            <>
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
                inputMode="numeric"
                autoComplete="one-time-code"
              />

              <button
                className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                onClick={verifyCode}
                disabled={!code.trim() || busy}
              >
                {busy ? "Verifying..." : "Continue"}
              </button>

              <button
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
            <Link
              href="/signup"
              className="block text-sm text-white/70 hover:text-white hover:underline underline-offset-4"
            >
              Create account
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
