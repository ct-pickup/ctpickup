"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Msg = {
  role: "user" | "assistant";
  text: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const EXAMPLE_QUESTIONS = [
  "How do I join a tournament?",
  "How do I join pickup?",
  "Where do I find training?",
  "How do I apply for U23?",
];

const WORD_LIMIT = 50;

function countWords(text: string) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-black/60"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function HelpPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typedIntro, setTypedIntro] = useState("");
  const [currentExample, setCurrentExample] = useState(EXAMPLE_QUESTIONS[0]);
  const [firstName, setFirstName] = useState("there");
  const [busy, setBusy] = useState(false);

  const fullIntro = `Hi, ${firstName}, what can I assist you with?`;
  const wordsUsed = countWords(input);
  const wordsRemaining = Math.max(0, WORD_LIMIT - wordsUsed);

  useEffect(() => {
    (async () => {
      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes.session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", user.id)
        .maybeSingle();

      const name = String(profile?.first_name || "").trim();
      if (name) setFirstName(name);
    })();
  }, []);

  useEffect(() => {
    setTypedIntro("");
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setTypedIntro(fullIntro.slice(0, i));
      if (i >= fullIntro.length) clearInterval(timer);
    }, 42);

    return () => clearInterval(timer);
  }, [fullIntro]);

  const canSend = useMemo(() => {
    const trimmed = input.trim();
    return trimmed.length > 0 && countWords(trimmed) <= WORD_LIMIT && !busy;
  }, [input, busy]);

  async function send() {
    const text = input.trim();
    if (!text || countWords(text) > WORD_LIMIT || busy) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setBusy(true);

    try {
      const r = await fetch("/api/help/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const j = await r.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: r.ok
            ? String(j?.text || "I couldn’t generate a reply.")
            : String(j?.error || "Something went wrong."),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Something went wrong connecting to help.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function pickRandomExample() {
    const pool = EXAMPLE_QUESTIONS.filter((q) => q !== currentExample);
    const next =
      pool[Math.floor(Math.random() * pool.length)] || EXAMPLE_QUESTIONS[0];
    setCurrentExample(next);
    setInput(next);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between gap-4">
          <div className="text-base md:text-lg font-semibold tracking-wide whitespace-nowrap">
            CT Pickup
          </div>

          <div className="hidden md:flex items-center gap-6">
            <Link href="/after-login" className="text-sm font-medium">
              Home
            </Link>
            <Link href="/pickup" className="text-sm font-medium">
              Pickup Games
            </Link>
            <Link href="/tournament" className="text-sm font-medium">
              Tournaments
            </Link>
            <Link href="/training" className="text-sm font-medium">
              Training
            </Link>
            <Link href="/u23" className="text-sm font-medium">
              U23
            </Link>
            <Link href="/info" className="text-sm font-medium">
              About
            </Link>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-black/15 px-3 py-1.5">
            <div className="h-8 w-8 rounded-full border border-black/15 flex items-center justify-center">
              <UserIcon />
            </div>
            <div className="text-sm font-medium max-w-[140px] truncate">
              Profile
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-14 space-y-8">
        <div className="space-y-2">
          <div className="min-h-[64px] text-4xl md:text-5xl font-semibold tracking-tight text-white leading-none">
            {typedIntro}
            {typedIntro.length < fullIntro.length ? (
              <span className="animate-pulse">|</span>
            ) : null}
          </div>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 space-y-6">
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={[
                  "max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-line",
                  m.role === "user"
                    ? "ml-auto bg-white text-black"
                    : "bg-black/40 text-white border border-white/10",
                ].join(" ")}
              >
                {m.text}
              </div>
            ))}

            {busy ? (
              <div className="max-w-[90%] rounded-2xl px-4 py-3 text-sm bg-black/40 text-white border border-white/10">
                Thinking...
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something here..."
              className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
              rows={4}
            />

            <div className="text-xs text-white/45">
              Words remaining: {wordsRemaining}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
              >
                Ask
              </button>

              <button
                type="button"
                onClick={pickRandomExample}
                className="rounded-md border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.04]"
              >
                Example questions
              </button>
            </div>

            {wordsRemaining <= 0 ? (
              <div className="text-sm text-white/60">
                You’ve reached the current word limit.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
