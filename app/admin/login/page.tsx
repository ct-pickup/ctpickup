"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="min-h-screen p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold">Admin Login</h1>

      <div className="mt-6 space-y-3">
        <input
          className="w-full rounded-lg border p-3"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="w-full rounded-lg border p-3 font-medium"
          onClick={sendLink}
          disabled={!email || sent}
        >
          {sent ? "Link sent" : "Send magic link"}
        </button>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {sent ? (
          <p className="text-sm text-gray-700">
            Check your email and click the link to finish signing in.
          </p>
        ) : null}
      </div>
    </main>
  );
}