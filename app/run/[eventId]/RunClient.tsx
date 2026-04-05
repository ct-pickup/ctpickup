"use client";

import { useEffect, useMemo, useState } from "react";
import { HistoryBack } from "@/components/layout";

type Choice = "A" | "B";
type Role = "field" | "goalie";

type EventRow = {
  id: string;
  status: "draft" | "active" | "locked" | "closed";
  time_option_a: string;
  time_option_b: string;
  locked_time: string | null;
  location_name: string | null;
  location_address: string | null;
  field_min: number;
  field_max: number;
  goalie_min: number;
  goalie_max: number;
};

type Counts = {
  a: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
  b: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function RunClient({ event, counts: initialCounts }: { event: EventRow; counts: Counts }) {
  const [ig, setIg] = useState("");
  const [name, setName] = useState("");

  const [choice, setChoice] = useState<Choice | null>(null);
  const [role, setRole] = useState<Role>("field");

  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [lockedChoice, setLockedChoice] = useState<Choice | null>(null);

  useEffect(() => {
    // load saved identity safely (no SSR crash)
    const savedIg = window.localStorage.getItem("ct_ig") || "";
    const savedName = window.localStorage.getItem("ct_name") || "";
    setIg(savedIg);
    setName(savedName);
  }, []);

  useEffect(() => {
    if (event.status === "locked" && event.locked_time) {
      setLockedChoice(event.locked_time === event.time_option_a ? "A" : "B");
    }
  }, [event]);

  const locked = event.status === "locked" && !!event.locked_time;

  const lockedLabel = useMemo(() => {
    if (!locked) return null;
    return `LOCKED: ${fmt(event.locked_time!)}`;
  }, [locked, event.locked_time]);

  function saveIdentity() {
    window.localStorage.setItem("ct_ig", ig.trim());
    window.localStorage.setItem("ct_name", name.trim());
  }

  async function doCommit() {
    setMsg(null);
    saveIdentity();

    if (!ig.trim()) return setMsg("Enter your Instagram handle.");
    if (!choice) return setMsg("Pick A or B.");

    const res = await fetch("/api/pickup/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: event.id,
        ig_handle: ig,
        name,
        choice,
        role,
      }),
    });

    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Failed.");

    setCounts(json.counts);
    setLockedChoice(json.locked_choice || lockedChoice || null);

    if (json.locked) setMsg(`Run locked for ${fmt(json.locked_time)}.`);
    else if (json.rsvp_status === "waitlist") setMsg("Role pool full for that option. You’re waitlisted.");
    else setMsg("RSVP recorded.");

    setConfirming(false);
  }

  async function doSwitch() {
    setMsg(null);
    saveIdentity();

    const res = await fetch("/api/pickup/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: event.id, ig_handle: ig }),
    });

    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Switch failed.");
    setMsg(json.message);
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <HistoryBack
        fallbackHref="/status/pickup"
        className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
      />
      <h1 className="text-2xl font-semibold">CT Pickup Run</h1>

      <div className="mt-2 text-sm text-gray-600">
        {event.location_name ? <div>{event.location_name}</div> : null}
        {event.location_address ? <div>{event.location_address}</div> : null}
        {lockedLabel ? <div className="mt-1 font-medium text-black">{lockedLabel}</div> : null}
      </div>

      <div className="mt-6 rounded-xl border p-4 space-y-3">
        <div className="font-medium">Your info</div>
        <input className="w-full rounded-lg border p-3" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full rounded-lg border p-3" placeholder="Instagram (required) e.g. ct.pickup" value={ig} onChange={(e) => setIg(e.target.value)} />

        <div className="pt-2">
          <div className="font-medium">Role</div>
          <div className="mt-2 flex gap-2">
            <button className={`rounded-lg border px-4 py-2 ${role === "field" ? "bg-black text-white" : ""}`} onClick={() => setRole("field")}>Field</button>
            <button className={`rounded-lg border px-4 py-2 ${role === "goalie" ? "bg-black text-white" : ""}`} onClick={() => setRole("goalie")}>Goalie</button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border p-4 space-y-3">
        <div className="font-medium">Pick a time</div>

        <button className={`w-full rounded-lg border p-3 text-left ${choice === "A" ? "bg-black text-white" : ""}`} onClick={() => setChoice("A")}>
          A) {fmt(event.time_option_a)}
          <div className="text-xs opacity-80 mt-1">
            field {counts.a.field_yes}/{event.field_max} • goalie {counts.a.goalie_yes}/{event.goalie_max} • waitlist {counts.a.waitlist}
          </div>
          <div className="text-xs opacity-80">Tier YES: 1A {counts.a.yes_1a} • 1B {counts.a.yes_1b}</div>
        </button>

        <button className={`w-full rounded-lg border p-3 text-left ${choice === "B" ? "bg-black text-white" : ""}`} onClick={() => setChoice("B")}>
          B) {fmt(event.time_option_b)}
          <div className="text-xs opacity-80 mt-1">
            field {counts.b.field_yes}/{event.field_max} • goalie {counts.b.goalie_yes}/{event.goalie_max} • waitlist {counts.b.waitlist}
          </div>
          <div className="text-xs opacity-80">Tier YES: 1A {counts.b.yes_1a} • 1B {counts.b.yes_1b}</div>
        </button>

        {!confirming ? (
          <button className="w-full rounded-lg border px-4 py-3 font-medium" onClick={() => setConfirming(true)}>
            Confirm RSVP
          </button>
        ) : (
          <div className="rounded-lg border p-3">
            <div className="font-medium">Confirm</div>
            <div className="text-sm text-gray-700 mt-1">
              You chose <b>YES</b> for <b>{choice}</b> as <b>{role}</b>. Confirm?
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-lg border px-4 py-2 bg-black text-white" onClick={doCommit}>Yes, confirm</button>
              <button className="rounded-lg border px-4 py-2" onClick={() => setConfirming(false)}>Change</button>
            </div>
          </div>
        )}

        {locked ? (
          <button className="w-full rounded-lg border px-4 py-3 font-medium" onClick={doSwitch}>
            Switch to locked time
          </button>
        ) : null}

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}
      </div>
    </main>
  );
}