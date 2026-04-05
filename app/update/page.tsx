"use client";

import { useEffect, useState } from "react";
import { HistoryBack } from "@/components/layout";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

function cleanIG(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

type ChangeType = "day_time" | "captain" | "phone" | "name" | "other";

export default function UpdatePage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [profileIG, setProfileIG] = useState<string | null>(null);

  const [instagram, setInstagram] = useState("");
  const [changeType, setChangeType] = useState<ChangeType>("day_time");
  const [newInfo, setNewInfo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("instagram")
        .eq("id", auth.user.id)
        .maybeSingle();

      if (prof?.instagram) {
        setProfileIG(prof.instagram);
        setInstagram(prof.instagram);
      }

      setLoading(false);
    })();
  }, [supabase, isReady]);

  async function submit() {
    if (!isReady || !supabase) return;
    setMsg(null);

    const ig = cleanIG(instagram);
    if (!ig) return setMsg("Instagram handle is required.");
    if (!newInfo.trim()) return setMsg("Please enter the new info.");

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return (window.location.href = "/login");

    setSubmitting(true);

    const { error } = await supabase.from("change_requests").insert({
      user_id: auth.user.id,
      instagram: ig,
      change_type: changeType,
      new_info: newInfo.trim(),
    });

    setSubmitting(false);

    if (error) return setMsg(error.message);

    setDone(true);
  }

  if (!isReady || loading) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <HistoryBack
          fallbackHref="/tournament"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        />
        <h1 className="text-2xl font-semibold">Loading…</h1>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen p-6 max-w-xl mx-auto">
        <HistoryBack
          fallbackHref="/tournament"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        />
        <h1 className="text-2xl font-semibold">Update received</h1>
        <p className="mt-3 text-gray-700">
          We’ve logged your change request. A CT Pickup member will review it soon.
        </p>

        <div className="mt-6 rounded-xl border p-4 space-y-2">
          <div><span className="text-gray-500">Instagram:</span> @{cleanIG(instagram)}</div>
          <div><span className="text-gray-500">What changed:</span> {changeType}</div>
          <div className="whitespace-pre-wrap"><span className="text-gray-500">New info:</span> {newInfo}</div>
        </div>

        <div className="mt-6 flex gap-3">
          <a className="underline" href="/status">Go to Status</a>
          <button className="rounded-lg border px-4 py-2" onClick={() => { setDone(false); setNewInfo(""); setMsg(null); }}>
            Submit another update
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <HistoryBack
        fallbackHref="/tournament"
        className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
      />
      <h1 className="text-2xl font-semibold">Fix / Edit My Submission</h1>
      <p className="mt-2 text-sm text-gray-600">
        Use this if something changed after you submitted tournament availability.
      </p>

      <div className="mt-6 space-y-3 rounded-xl border p-4">
        <label className="block">
          <div className="text-sm text-gray-600">Instagram handle (required)</div>
          <input
            className="w-full rounded-lg border p-3"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            placeholder="@yourhandle"
          />
          {profileIG ? (
            <div className="mt-1 text-xs text-gray-500">
              Autofilled from your profile. You can edit if needed.
            </div>
          ) : null}
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">What changed?</div>
          <select
            className="w-full rounded-lg border p-3"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as ChangeType)}
          >
            <option value="day_time">Day/time availability</option>
            <option value="captain">Captain status</option>
            <option value="phone">Phone number</option>
            <option value="name">Name</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">New info</div>
          <textarea
            className="w-full rounded-lg border p-3 min-h-[120px]"
            value={newInfo}
            onChange={(e) => setNewInfo(e.target.value)}
            placeholder="Type the new info exactly as you want it recorded."
          />
        </label>

        <button
          className="rounded-lg border px-4 py-3 font-medium"
          onClick={submit}
          disabled={submitting || !cleanIG(instagram) || !newInfo.trim()}
        >
          {submitting ? "Submitting..." : "Submit update"}
        </button>

        {msg ? <p className="text-sm text-red-600">Error: {msg}</p> : null}
      </div>
    </main>
  );
}
