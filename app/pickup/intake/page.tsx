"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HistoryBack } from "@/components/layout";
import { readJsonSafely, userFacingMessageForError } from "@/lib/client/apiErrors";

type Role = "assistant" | "user";
type Msg = { role: Role; text: string };

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  phone?: string;
  level?: string;
  town?: string;
  position?: string;
  availability?: string;
};

export default function PickupIntakePage() {
  const firstQuestion = "What’s your full name?";

  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", text: firstQuestion },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [collected, setCollected] = useState<Collected>({});
  const [lastQuestion, setLastQuestion] = useState(firstQuestion);
  const [done, setDone] = useState(false);
  const [crisis, setCrisis] = useState(false);

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading && !done,
    [input, loading, done]
  );

  async function send() {
    if (!canSend) return;

    const userText = input.trim();
    setInput("");
    setLoading(true);
    setMessages((m) => [...m, { role: "user", text: userText }]);

    try {
      const payload = {
        user_message: userText,
        last_question: lastQuestion,
        collected_fields: collected,
      };

      // Debug: helpful when diagnosing production failures.
      if (process.env.NODE_ENV !== "production") {
        console.log("[pickup/intake] submit:", payload);
      }

      const res = await fetch("/api/pickup/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { data } = await readJsonSafely(res);
      const j = (data ?? {}) as any;

      if (!res.ok) {
        const msg = userFacingMessageForError({ response: res, data });
        if (process.env.NODE_ENV !== "production") {
          console.error("[pickup/intake] submit_http_error:", { status: res.status, data });
        }
        setMessages((m) => [...m, { role: "assistant", text: msg }]);
        setLoading(false);
        return;
      }

      setCollected(j.collected_fields || {});
      setDone(!!j.done);
      setCrisis(!!j.crisis);

      const next = (j.next_question || "").trim();
      if (next) {
        setMessages((m) => [...m, { role: "assistant", text: next }]);
        setLastQuestion(next);
      }

      setLoading(false);
    } catch (e: unknown) {
      const msg = userFacingMessageForError({ err: e });
      if (process.env.NODE_ENV !== "production") {
        console.error("[pickup/intake] submit_failed:", e);
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", text: msg },
      ]);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-3xl px-6 py-14 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-h1 font-serif font-semibold">
            PICKUP INTAKE
          </h1>
          <HistoryBack
            fallbackHref="/pickup"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-ink underline underline-offset-4 transition hover:text-ink"
          />
        </div>

        <div className="rounded-card border border-line bg-overlay-subtle p-6 space-y-4">
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={[
                  "max-w-[85%] rounded-card px-4 py-3 text-small leading-relaxed border",
                  m.role === "assistant"
                    ? "bg-overlay-subtle border-line text-ink"
                    : "ml-auto bg-pitch text-on-pitch border-line",
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
              className="rounded-button px-5 py-3 text-small font-semibold bg-pitch text-on-pitch disabled:opacity-50"
            >
              Send
            </button>
          </div>

          {done && !crisis && (
            <div className="pt-2 text-small text-muted">
              Submission received.
              <div className="mt-3 flex gap-4">
                <Link href="/info" className="underline text-ink">
                  Info
                </Link>
              </div>
            </div>
          )}

          {done && crisis && (
            <div className="pt-2 text-small text-muted">
              If you’re in immediate danger, call 911. If you’re in the U.S., call or text 988.
              <div className="mt-3">
                <Link href="/info" className="underline text-ink">
                  Info
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="text-caption text-muted">
          Eligibility: college / former college / ECNL / MLS Next. Minimum age: 16.
        </div>
      </div>
    </main>
  );
}
