"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Role = "assistant" | "user";
type Msg = { role: Role; text: string };

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  phone?: string;
  messaging_app?: string;
  level?: string;
  availability?: string;
};

export default function IntakeFlow() {
  const firstQuestion = "What’s your full name?";

  const [agreed, setAgreed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [scrolledBottom, setScrolledBottom] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [collected, setCollected] = useState<Collected>({});
  const [lastQuestion, setLastQuestion] = useState(firstQuestion);
  const [done, setDone] = useState(false);
  const [crisis, setCrisis] = useState(false);

  useEffect(() => {
    if (!showModal) setScrolledBottom(false);
  }, [showModal]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
    if (nearBottom) setScrolledBottom(true);
  }

  function startChat() {
    setAgreed(true);
    setShowModal(false);
    setMessages([{ role: "assistant", text: firstQuestion }]);
    setLastQuestion(firstQuestion);
    setDone(false);
    setCrisis(false);
    setCollected({});
    setInput("");
  }

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading && !done && agreed,
    [input, loading, done, agreed]
  );

  async function send() {
    if (!canSend) return;

    const userText = input.trim();
    setInput("");
    setLoading(true);

    setMessages((m) => [...m, { role: "user", text: userText }]);

    try {
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: userText,
          last_question: lastQuestion,
          collected_fields: collected,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data?.error || "Something went wrong. Try again." },
        ]);
        setLoading(false);
        return;
      }

      setCollected(data.collected_fields || {});
      setDone(!!data.done);
      setCrisis(!!data.crisis);

      const next = (data.next_question || "").trim();
      if (next) {
        setMessages((m) => [...m, { role: "assistant", text: next }]);
        setLastQuestion(next);
      }

      setLoading(false);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error. Try again." }]);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-14 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">TOURNAMENT INTAKE</h1>
          <Link href="/tournament" className="text-sm underline text-white/80">
            Back
          </Link>
        </div>

        {!agreed ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
            <div className="text-white/85">
              Read <Link href="/rules" className="underline">Rules & Eligibility</Link> before submitting.
            </div>

            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-white w-full sm:w-auto"
            >
              ENTER TOURNAMENT
            </button>

            <div className="text-sm text-white/60">
              Required: you must read and agree to the rules before submitting.
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={[
                    "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed border",
                    m.role === "assistant"
                      ? "bg-white/[0.03] border-white/10 text-white/85"
                      : "ml-auto bg-white text-white border-white/20",
                  ].join(" ")}
                >
                  {m.text}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-white/10" />

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                disabled={loading || done}
                placeholder={done ? "Submitted." : "Type your answer…"}
                className="w-full rounded-md bg-black border border-white/15 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none"
              />

              <button
                onClick={send}
                disabled={!canSend}
                className="rounded-md px-5 py-3 text-sm font-semibold bg-white text-white disabled:opacity-50"
              >
                Send
              </button>
            </div>

            {done && !crisis && (
  <div className="pt-2 text-sm text-white/70">
    Submission received.
    <div className="mt-3 flex gap-4">
      <Link href="/status/tournament" className="underline text-white/80">
        Tournament Status
      </Link>
      <Link href="/" className="underline text-white/80">
        Home
      </Link>
    </div>
  </div>
)}

{done && crisis && (
  <div className="pt-2 text-sm text-white/70">
    If you’re in immediate danger, call 911. If you’re in the U.S., call or text 988.
    <div className="mt-3">
      <Link href="/" className="underline text-white/80">
        Home
      </Link>
    </div>
  </div>
)}

            <div className="text-xs text-white/50">
              <Link href="/rules" className="underline">Rules & Eligibility</Link>
            </div>
          </div>
        )}

        {/* Agreement Modal */}
        {/* Agreement Modal */}
{showModal && (
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6 text-white border border-white/10">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/60">
            SUBMISSION AGREEMENT
          </div>
          <div className="text-white/80">
            You must read and agree to the rules before submitting.
          </div>
        </div>

        <button
          onClick={() => setShowModal(false)}
          className="text-sm underline text-white/60"
        >
          Close
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="mt-5 h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-5 space-y-4 text-white/80"
      >
        <div className="font-semibold uppercase text-white/90">
          HOW THIS WORKS (READ BEFORE SUBMITTING)
        </div>

        <p>
          Captains and players must submit their entry at least 48 hours before the tournament start time.
        </p>

        <p>
          Team spots are limited. Once the maximum number of teams is reached, the Status Board will show that the tournament is full.
        </p>

        <p>
          The count on the Status Board can update as submissions are approved or removed.
        </p>

        <p>
          Once the tournament is full, additional teams will not be included in the tournament group.
        </p>

        <p>
          Minimum roster size is required to submit a team. The goalkeeper does count toward your minimum player total.
        </p>

        <p className="text-sm text-white/60">
          Read <Link href="/rules" className="underline">Rules & Eligibility</Link> for eligibility and behavior standards.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        

        <button
          onClick={startChat}
          disabled={!scrolledBottom}
          className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-black text-white w-full sm:w-auto disabled:opacity-50"
        >
          CONTINUE
        </button>
      </div>
    </div>
  </div>
)}
      </div>
    </main>
  );
}
