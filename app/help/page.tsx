"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SupportEmailLink } from "@/components/SupportEmailLink";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import {
  filterNavActionsForClient,
  type HelpNavAction,
} from "@/lib/helpNavWhitelist";

type Msg = {
  role: "user" | "assistant";
  text: string | ReactNode;
  actions?: HelpNavAction[];
};

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

/** Turn bare https URLs in assistant copy into external links (e.g. 988 Lifeline). */
function assistantTextWithHttpsLinks(text: string): ReactNode {
  const segments = text.split(/(https:\/\/[^\s]+)/g);
  return segments.map((seg, i) => {
    if (!/^https:\/\//.test(seg)) {
      return <span key={i}>{seg}</span>;
    }
    const href = seg.replace(/[.,;:!?)\]]+$/g, "");
    const tail = seg.slice(href.length);
    return (
      <span key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-muted underline underline-offset-2 hover:text-muted"
        >
          {href}
        </a>
        {tail}
      </span>
    );
  });
}

export default function HelpPage() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typedIntro, setTypedIntro] = useState("");
  const [currentExample, setCurrentExample] = useState(EXAMPLE_QUESTIONS[0]);
  const [firstName, setFirstName] = useState("there");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const fullIntro = `Hi, ${firstName}, what can I assist you with?`;
  const wordsUsed = countWords(input);
  const wordsRemaining = Math.max(0, WORD_LIMIT - wordsUsed);

  useEffect(() => {
    if (!isReady) return;
    if (!supabase) {
      setAuthResolved(true);
      setIsLoggedIn(false);
      return;
    }

    const client = supabase;

    async function syncUser() {
      const { data: userRes, error: userErr } = await client.auth.getUser();
      const user = userErr ? null : userRes.user;
      setIsLoggedIn(!!user);
      setAuthResolved(true);

      if (!user) {
        setFirstName("there");
        setIsAdmin(false);
        return;
      }

      const { data: profile } = await client
        .from("profiles")
        .select("first_name, is_admin")
        .eq("id", user.id)
        .maybeSingle();

      const name = String(profile?.first_name || "").trim();
      if (name) setFirstName(name);
      setIsAdmin(!!profile?.is_admin);
    }

    void syncUser();
    const { data: sub } = client.auth.onAuthStateChange(() => {
      void syncUser();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, isReady]);

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
    return (
      isReady &&
      trimmed.length > 0 &&
      countWords(trimmed) <= WORD_LIMIT &&
      !busy
    );
  }, [input, busy, isReady]);

  async function send() {
    if (!isReady) return;
    const text = input.trim();
    if (!text || countWords(text) > WORD_LIMIT || busy) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setBusy(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (supabase) {
        const { data: sessionRes } = await supabase.auth.getSession();
        const accessToken = sessionRes.session?.access_token;
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }
      }

      const r = await fetch("/api/help/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ question: text }),
      });
      let j: { text?: unknown; error?: unknown; actions?: unknown };
      try {
        j = await r.json();
      } catch (parseErr) {
        console.error("[help] /api/help/chat response was not JSON", parseErr);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: (
              <>
                Invalid response from help service. Please try again, or email{"  "}
                <SupportEmailLink className="font-medium text-muted underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-line rounded-button" />
                .
              </>
            ),
          },
        ]);
        return;
      }

      const assistantBody: string | ReactNode = r.ok
        ? String(j?.text || "I couldn’t generate a reply.")
        : (
            <>
              {String(j?.error || "Something went wrong.")}{"  "}
              You can also email{"  "}
              <SupportEmailLink className="font-medium text-muted underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-line rounded-button" />
              .
            </>
          );
      const rawActions = r.ok && Array.isArray(j?.actions) ? j.actions : [];
      const actions = filterNavActionsForClient(rawActions, { isAdmin });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: assistantBody,
          ...(actions.length ? { actions } : {}),
        },
      ]);
    } catch (err) {
      console.error("[help] /api/help/chat request failed", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: (
            <>
              Something went wrong connecting to help. You can email{"  "}
              <SupportEmailLink className="font-medium text-muted underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-line rounded-button" />{"  "}
              for assistance.
            </>
          ),
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
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
        showPrimaryNav={authResolved && isLoggedIn}
      />
      <EsportsSetupNudgeBar />

      <div className="mx-auto max-w-4xl space-y-8 pb-16 pt-4">
        <div className="space-y-2">
          <div className="min-h-[64px] text-display font-serif md:text-display font-semibold text-ink leading-none">
            {typedIntro}
            {typedIntro.length < fullIntro.length ? (
              <span className="animate-pulse">|</span>
            ) : null}
          </div>
        </div>

        <p className="rounded-card border border-line bg-overlay-subtle px-4 py-3 text-small leading-relaxed text-ink md:px-5">
          Need help from a person? Email{"  "}
          <SupportEmailLink className="font-medium text-muted underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-button" />
          .
        </p>

        <Panel className="space-y-6 p-6 md:p-8">
          <div className="space-y-4">
            {messages.map((m, i) => {
              const safeActions =
                m.role === "assistant"
                  ? filterNavActionsForClient(m.actions, { isAdmin })
                  : [];
              return (
                <div
                  key={i}
                  className={[
                    "max-w-[90%] rounded-card px-4 py-3 text-small whitespace-pre-line",
                    m.role === "user"
                      ? "ml-auto bg-pitch text-on-pitch"
                      : "bg-overlay-subtle text-ink border border-line",
                  ].join("  ")}
                >
                  {m.role === "assistant" ? (
                    typeof m.text === "string" ? (
                      assistantTextWithHttpsLinks(m.text)
                    ) : (
                      m.text
                    )
                  ) : (
                    m.text
                  )}
                  {safeActions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                      {safeActions.map((a) => (
                        <Link
                          key={`${a.href}-${a.label}`}
                          href={a.href}
                          title={a.reason}
                          className="inline-flex items-center rounded-pill border border-line bg-overlay px-3 py-1.5 text-caption font-semibold text-ink transition hover:border-line hover:bg-overlay-strong"
                        >
                          {a.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {busy ? (
              <div className="max-w-[90%] rounded-card px-4 py-3 text-small bg-overlay-subtle text-ink border border-line">
                Thinking...
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something here..."
              className="w-full rounded-card border border-line bg-canvas px-4 py-3 text-small text-ink placeholder:text-muted outline-none focus:border-line"
              rows={4}
            />

            <div className="text-caption text-muted">
              Words remaining: {wordsRemaining}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="rounded-button bg-pitch px-5 py-2.5 text-small font-semibold text-on-pitch disabled:opacity-50"
              >
                Ask
              </button>

              <button
                type="button"
                onClick={pickRandomExample}
                className="rounded-button border border-line bg-canvas px-5 py-2.5 text-small font-semibold text-ink hover:bg-overlay-subtle"
              >
                Example questions
              </button>
            </div>

            {wordsRemaining <= 0 ? (
              <div className="text-small text-muted">
                You’ve reached the current word limit.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
