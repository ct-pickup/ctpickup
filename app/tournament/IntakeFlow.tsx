"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { HistoryBack } from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";

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
      const res = await fetch("/api/tournament/intake", {
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
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-3xl px-6 py-14 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-h1 font-serif font-semibold">TOURNAMENT INTAKE</h1>
          <HistoryBack
            fallbackHref="/tournament"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-ink underline underline-offset-4 transition hover:text-ink"
          />
        </div>

        {!agreed ? (
          <div className="rounded-card border border-line bg-overlay-subtle p-8 space-y-4">
            <div className="text-ink">
              Read <Link href="/rules" className="underline">Rules & Eligibility</Link> before submitting.
            </div>

            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center justify-center rounded-button px-5 py-3 text-small font-semibold bg-card text-ink w-full sm:w-auto"
            >
              ENTER TOURNAMENT
            </button>

            <div className="text-small text-muted">
              Required: you must read and agree to the rules before submitting.
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-overlay-subtle p-6 space-y-4">
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={[
                    "max-w-[85%] rounded-card px-4 py-3 text-small leading-relaxed border",
                    m.role === "assistant"
                      ? "bg-overlay-subtle border-line text-ink"
                      : "ml-auto bg-card text-ink border-line",
                  ].join("  ")}
                >
                  {m.text}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-line" />

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                disabled={loading || done}
                placeholder={done ? "Submitted." : "Type your answer…"}
                className="w-full rounded-button bg-canvas border border-line px-4 py-3 text-small text-ink placeholder:text-muted outline-none"
              />

              <button
                onClick={send}
                disabled={!canSend}
                className="rounded-button px-5 py-3 text-small font-semibold bg-card text-ink disabled:opacity-50"
              >
                Send
              </button>
            </div>

            {done && !crisis && (
  <div className="pt-2 text-small text-muted">
    Submission received.
    <div className="mt-3 flex gap-4">
      <Link href="/status/tournament" className="underline text-ink">
        Tournament Status
      </Link>
      <Link href={APP_HOME_URL} className="underline text-ink">
        Home
      </Link>
    </div>
  </div>
)}

{done && crisis && (
  <div className="pt-2 text-small text-muted">
    If you’re in immediate danger, call 911. If you’re in the U.S., call or text 988.
    <div className="mt-3">
      <Link href={APP_HOME_URL} className="underline text-ink">
        Home
      </Link>
    </div>
  </div>
)}

            <div className="text-caption text-muted">
              <Link href="/rules" className="underline">Rules & Eligibility</Link>
            </div>
          </div>
        )}

        {/* Agreement Modal */}
        {/* Agreement Modal */}
{showModal && (
<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm">    <div className="w-full max-w-2xl rounded-card border border-line bg-canvas p-6 text-ink">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <div className="text-small font-semibold text-muted">
            SUBMISSION AGREEMENT
          </div>
          <div className="text-ink">
            You must read and agree to the rules before submitting.
          </div>
        </div>

        <button
          onClick={() => setShowModal(false)}
          className="text-small underline text-muted"
        >
          Close
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="mt-5 h-72 overflow-y-auto rounded-card border border-line bg-overlay-subtle p-5 space-y-4 text-ink"
      >
        <div className="font-semibold text-ink">
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

        <p className="text-small text-muted">
          Read <Link href="/rules" className="underline">Rules & Eligibility</Link> for eligibility and behavior standards.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        

        <button
          onClick={startChat}
          disabled={!scrolledBottom}
          className="inline-flex items-center justify-center rounded-button px-5 py-3 text-small font-semibold bg-canvas text-ink w-full sm:w-auto disabled:opacity-50"
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
