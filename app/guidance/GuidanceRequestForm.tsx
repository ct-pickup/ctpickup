"use client";

import { SupportEmailLink } from "@/components/SupportEmailLink";
import { SUPPORT_EMAIL_ADDRESS } from "@/lib/supportEmail";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { WaiverAcceptanceModal } from "@/components/waiver/WaiverAcceptanceModal";
import type { GuidancePlan } from "@/lib/guidanceRequest";
import { GUIDANCE_PLAN_DEFINITIONS, formatGuidancePriceUsd } from "@/lib/guidancePlans";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

const PLAN_OPTIONS = GUIDANCE_PLAN_DEFINITIONS.map((p) => ({
  value: p.key,
  label: `${p.title} — ${formatGuidancePriceUsd(p.priceUsd)}`,
}));

type Props = {
  plan: GuidancePlan;
  onPlanChange: (p: GuidancePlan) => void;
};

const errLinkClass =
  "font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f10] rounded-sm";

function apiErrorWithMailto(text: string): ReactNode {
  if (!text.includes(SUPPORT_EMAIL_ADDRESS)) return text;
  const parts = text.split(SUPPORT_EMAIL_ADDRESS);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <SupportEmailLink className={errLinkClass} />
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

export function GuidanceRequestForm({ plan, onPlanChange }: Props) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [message, setMessage] = useState("");
  const [sportFocus, setSportFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode | null>(null);
  const [done, setDone] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);

  useEffect(() => {
    if (!isReady || !supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSessionToken(data.session?.access_token ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isReady || !supabase) return;
    setError(null);
    setBusy(true);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) {
        setError("Sign in to submit a request.");
        setBusy(false);
        return;
      }

      const r = await fetch("/api/guidance/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan,
          message,
          sport_focus: sportFocus.trim() || null,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403 && j?.error === "waiver_required") {
          setWaiverModalOpen(true);
          setBusy(false);
          return;
        }
        setError(
          typeof j?.error === "string" ? (
            apiErrorWithMailto(j.error)
          ) : (
            <>
              Something went wrong. Try again or email{" "}
              <SupportEmailLink className={errLinkClass} />.
            </>
          ),
        );
        setBusy(false);
        return;
      }

      setDone(true);
      setMessage("");
      setSportFocus("");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-6 text-sm leading-relaxed text-white/90">
        <p className="font-semibold text-white">Request received.</p>
        <p className="mt-2 text-white/80">
          Your request is saved to our system. We will follow up using the path
          that fits your request. You can send another note anytime if
          something changes.
        </p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-4 text-sm font-medium text-white/90 underline underline-offset-4 hover:text-white"
        >
          Send another request
        </button>
      </div>
    );
  }

  return (
    <>
      {waiverModalOpen && sessionToken ? (
        <WaiverAcceptanceModal
          token={sessionToken}
          onClose={() => setWaiverModalOpen(false)}
          onAccepted={() => {
            setWaiverModalOpen(false);
            setError(null);
          }}
        />
      ) : null}

    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <label
          htmlFor="guidance-plan"
          className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/50"
        >
          Plan
        </label>
        <select
          id="guidance-plan"
          value={plan}
          onChange={(e) => onPlanChange(e.target.value as GuidancePlan)}
          className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none focus:border-white/30"
        >
          {PLAN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="guidance-sport"
          className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/50"
        >
          Sport or focus{" "}
          <span className="font-normal normal-case tracking-normal text-white/35">
            (optional)
          </span>
        </label>
        <input
          id="guidance-sport"
          type="text"
          value={sportFocus}
          onChange={(e) => setSportFocus(e.target.value)}
          maxLength={280}
          placeholder="e.g. soccer, position, school year, goal"
          className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/30"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="guidance-message"
          className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/50"
        >
          What do you need help with?
        </label>
        <textarea
          id="guidance-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          required
          placeholder="Context, goals, where you feel stuck — whatever helps us understand."
          className="w-full resize-y rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/30"
        />
      </div>

      {error ? (
        <p className="text-sm text-amber-200/90" role="alert">
          {error}{" "}
          {typeof error === "string" && error.includes("Sign in") ? (
            <Link href="/login" className="underline underline-offset-2">
              Log in
            </Link>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !isReady}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-white/25 bg-white px-6 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50 sm:w-auto"
      >
        {busy ? "Sending…" : "Request guidance"}
      </button>
    </form>
    </>
  );
}
