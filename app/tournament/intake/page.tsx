"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Role = "assistant" | "user";

type Msg = {
  role: Role;
  text: string;
};

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  phone?: string;
  level?: string;
  availability?: string;
};

export default function TournamentIntakePage() {
  const firstQuestion = "What’s your full name?";
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", text: firstQuestion },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [collected, setCollected] = useState<Collected>({});
  const [lastQuestion, setLastQuestion] = useState(firstQuestion);
  const [done, setDone] = useState(false);

  const canSend = useMemo(() => input.trim().length > 0 && !loading && !done, [input, loading, done]);

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

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={[
                  "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed border",
                  m.role === "assistant"
                    ? "bg-white/[0.03] border-white/10 text-white/85"
                    : "ml-auto bg-white text-black border-white/20",
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
              className="rounded-md px-5 py-3 text-sm font-semibold bg-white text-black disabled:opacity-50"
            >
              Send
            </button>
          </div>

          {done && (
            <div className="pt-2 text-sm text-white/70">
              Done. You’re in. We’ll follow up with next steps.
              <div className="mt-3">
                <Link href="/" className="underline text-white/80">
                  Home
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="text-xs text-white/50">
          Minimum age: 16. Competitive environment.
        </div>
      </div>
    </main>
  );
}
