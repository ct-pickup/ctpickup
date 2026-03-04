"use client";

import { useState } from "react";

type EventRow = any;

export default function AdminPickupPage() {
  const [title, setTitle] = useState("CT Pickup Run");
  const [locName, setLocName] = useState("");
  const [locAddr, setLocAddr] = useState("");
  const [aTime, setATime] = useState("");
  const [bTime, setBTime] = useState("");
  const [event, setEvent] = useState<EventRow | null>(null);

  const [waveResult, setWaveResult] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function createRun() {
    setMsg(null);
    const res = await fetch("/api/admin/pickup/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        status: "active",
        time_option_a: aTime,
        time_option_b: bTime,
        location_name: locName || null,
        location_address: locAddr || null,
      }),
    });

    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Create failed.");
    setEvent(json.event);
    setWaveResult(null);
    setMsg("Created.");
  }

  async function invite(wave: "1A" | "1B" | "2") {
    if (!event?.id) return setMsg("Create a run first.");
    setMsg(null);

    const res = await fetch("/api/admin/pickup/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: event.id, wave }),
    });

    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Invite failed.");
    setWaveResult(json);
    setMsg(`Wave ${wave}: ${json.count} handles.`);
  }

  const runLink = event ? `${window.location.origin}/run/${event.id}` : "";
  const statusLink = `${window.location.origin}/status`;

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold">Admin · Pickup</h1>
      <p className="mt-2 text-sm text-gray-600">
        Tip: access this page via <code>/admin/pickup?key=ADMIN_SECRET</code> once to set the cookie.
      </p>

      <div className="mt-6 rounded-xl border p-4 space-y-3">
        <div className="font-medium">Create run</div>
        <input className="w-full rounded-lg border p-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input className="w-full rounded-lg border p-3" value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Location name" />
        <input className="w-full rounded-lg border p-3" value={locAddr} onChange={(e) => setLocAddr(e.target.value)} placeholder="Location address" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="w-full rounded-lg border p-3" value={aTime} onChange={(e) => setATime(e.target.value)} placeholder="Time option A (ISO or text)" />
          <input className="w-full rounded-lg border p-3" value={bTime} onChange={(e) => setBTime(e.target.value)} placeholder="Time option B (ISO or text)" />
        </div>

        <button className="rounded-lg border px-4 py-3 font-medium" onClick={createRun}>
          Create + Activate
        </button>
      </div>

      {event ? (
        <div className="mt-4 rounded-xl border p-4 space-y-2">
          <div className="font-medium">Current run</div>
          <div className="text-sm">ID: <code>{event.id}</code></div>
          <div className="text-sm">A: {String(event.time_option_a)}</div>
          <div className="text-sm">B: {String(event.time_option_b)}</div>
          <div className="text-sm">Run link: <code>{runLink}</code></div>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border p-4 space-y-2">
        <div className="font-medium">Invite waves (outputs IG handles)</div>
        <div className="flex gap-2 flex-wrap">
          <button className="rounded-lg border px-4 py-2" onClick={() => invite("1A")}>Invite 1A</button>
          <button className="rounded-lg border px-4 py-2" onClick={() => invite("1B")}>Invite 1B</button>
          <button className="rounded-lg border px-4 py-2" onClick={() => invite("2")}>Invite 2</button>
        </div>

        {waveResult?.handles ? (
          <div className="mt-3">
            <div className="text-sm font-medium">Handles to DM</div>
            <textarea className="mt-2 w-full rounded-lg border p-3 h-32" readOnly value={waveResult.handles.join("\n")} />
            <div className="text-sm font-medium mt-3">DM template</div>
            <textarea
              className="mt-2 w-full rounded-lg border p-3 h-32"
              readOnly
              value={`Got you. Today’s options:\nA) ${String(event?.time_option_a)}\nB) ${String(event?.time_option_b)}\nRSVP + role here: ${runLink}\nUpdates: ${statusLink}\n\nReply RUN for a chance to get in.`}
            />
          </div>
        ) : null}
      </div>

      {msg ? <p className="mt-4 text-sm text-red-600">{msg}</p> : null}
    </main>
  );
}