"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    setMsg(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    setStage("code");
    setMsg("Code sent. Check your email.");
  }

  async function verifyCode() {
    setBusy(true);
    setMsg(null);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    window.location.href = "/onboarding";
  }

  return (
    <main className="min-h-screen p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="mt-2 text-sm text-gray-600">
        We’ll email you a verification code. No password.
      </p>

      <div className="mt-6 space-y-3">
        <input
          className="w-full rounded-lg border p-3"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={stage === "code"}
        />

        {stage === "email" ? (
          <button
            className="w-full rounded-lg border p-3 font-medium"
            onClick={sendCode}
            disabled={!email || busy}
          >
            {busy ? "Sending..." : "Send code"}
          </button>
        ) : (
          <>
            <input
              className="w-full rounded-lg border p-3"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="w-full rounded-lg border p-3 font-medium"
              onClick={verifyCode}
              disabled={!code || busy}
            >
              {busy ? "Verifying..." : "Verify & continue"}
            </button>

            <button
              className="w-full rounded-lg border p-3"
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

        {msg ? <p className="text-sm text-gray-700">{msg}</p> : null}
      </div>
    </main>
  );
}
