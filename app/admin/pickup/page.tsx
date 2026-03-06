"use client";

import PageTop from "@/components/PageTop";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AdminPickupPage() {
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("CT Pickup Run");
  const [runType, setRunType] = useState<"select" | "public">("select");
  const [startAt, setStartAt] = useState("");
  const [capacity, setCapacity] = useState(24);
  const [feeCents, setFeeCents] = useState(0);
  const [locationText, setLocationText] = useState("");
  const [deadline, setDeadline] = useState("");

  useEffect(() => {
    (async () => {
      const s = await supabase.auth.getSession();
      const t = s.data.session?.access_token || null;
      setToken(t);

      if (t) {
        const u = await supabase.auth.getUser();
        const uid = u.data.user?.id;
        if (uid) {
          const p = await supabase.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
          setIsAdmin(!!p.data?.is_admin);
        }
      }
    })();
  }, []);

  async function createRun() {
    if (!token) return;
    setMsg(null);

    const r = await fetch("/api/admin/pickup/create-run", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        run_type: runType,
        start_at: startAt,
        capacity,
        fee_cents: feeCents,
        location_text: locationText,
        cancellation_deadline: deadline,
      }),
    });

    const j = await r.json();
    if (!r.ok) return setMsg(j?.error || "Failed.");
    setMsg("Run created.");
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-black text-white">
        <PageTop title="ADMIN" />
        <div className="mx-auto max-w-4xl px-6 py-10 text-white/80">Log in first.</div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-black text-white">
        <PageTop title="ADMIN" />
        <div className="mx-auto max-w-4xl px-6 py-10 text-white/80">Not authorized.</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="ADMIN · PICKUP" />
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 space-y-4">
          <div className="text-lg font-semibold uppercase tracking-wide text-white/90">Create run</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <select className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={runType} onChange={(e) => setRunType(e.target.value as any)}>
              <option value="select">select</option>
              <option value="public">public</option>
            </select>

            <input className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={startAt} onChange={(e) => setStartAt(e.target.value)} placeholder="Start time (ISO or 2026-03-10T18:00:00-05:00)" />

            <input type="number" className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} placeholder="Capacity" />

            <input type="number" className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={feeCents} onChange={(e) => setFeeCents(Number(e.target.value))} placeholder="Fee cents (0 = free)" />

            <input className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
              value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="Cancellation deadline (ISO)" />
          </div>

          <textarea className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
            value={locationText} onChange={(e) => setLocationText(e.target.value)} rows={4}
            placeholder="Location text (only confirmed players will see this)" />

          <button onClick={createRun} className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black">
            Create
          </button>

          {msg ? <div className="text-sm text-white/70">{msg}</div> : null}
        </section>
      </div>
    </main>
  );
}
