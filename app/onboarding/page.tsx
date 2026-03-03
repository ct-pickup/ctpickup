"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function cleanIG(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export default function OnboardingPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
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
  }, []);

  async function save() {
    setMsg(null);

    const ig = cleanIG(instagram);
    if (!firstName.trim()) return setMsg("First name is required.");
    if (!lastName.trim()) return setMsg("Last name is required.");
    if (!ig) return setMsg("Instagram is required.");
    if (!phone.trim()) return setMsg("Phone is required.");

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    const { error } = await supabase.from("profiles").insert({
      id: auth.user.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      instagram: ig,
      phone: phone.trim(),
    });

    if (error) return setMsg(error.message);

    window.location.href = "/tournament";
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold">Setting up…</h1>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
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

        <button className="rounded-lg border px-4 py-3 font-medium" onClick={save}>
          Save & continue
        </button>

        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
      </div>
    </main>
  );
}
