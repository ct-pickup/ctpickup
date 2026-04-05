"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Panel } from "@/components/layout";
import {
  GUIDANCE_PLAN_DEFINITIONS,
  formatGuidancePriceUsd,
} from "@/lib/guidancePlans";
import { parseGuidancePlan, type GuidancePlan } from "@/lib/guidanceRequest";
import { profileDisplayName, type ProfileRow } from "@/lib/profileFields";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { GuidanceRequestForm } from "./GuidanceRequestForm";

export function GuidancePlansAndRequest() {
  const searchParams = useSearchParams();
  const { supabase, isReady } = useSupabaseBrowser();

  const planFromUrl = parseGuidancePlan(searchParams.get("plan"));
  const [plan, setPlan] = useState<GuidancePlan>(planFromUrl ?? "foundation");

  useEffect(() => {
    const p = parseGuidancePlan(searchParams.get("plan"));
    if (p) setPlan(p);
  }, [searchParams]);

  const [profileHint, setProfileHint] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !supabase) return;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session?.user) {
        setProfileHint(null);
        return;
      }
      const u = s.session.user;
      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name,last_name,tier")
        .eq("id", u.id)
        .maybeSingle();
      const name = profileDisplayName(prof as ProfileRow | null);
      const bits = [name || null, u.email || null].filter(Boolean);
      setProfileHint(bits.length ? bits.join(" · ") : u.email || null);
    })();
  }, [supabase, isReady]);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
          Player development plans
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
          Choose the level of support that fits your goals. Final pricing and
          details are confirmed with you before anything moves forward.
        </p>
      </div>

      <div className="grid gap-5 lg:gap-6">
        {GUIDANCE_PLAN_DEFINITIONS.map((p) => (
          <Panel
            key={p.key}
            className="flex flex-col border-white/12 p-6 md:p-8 lg:min-h-0"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
                  {p.title}
                </h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                  Experience-based guidance — not licensed professional advising
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums text-white md:text-3xl">
                  {formatGuidancePriceUsd(p.priceUsd)}
                </div>
                <div className="text-[11px] text-white/45">Starting at</div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-white/78 md:text-base">
              {p.description}
            </p>

            <div className="mt-5 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                Includes
              </p>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-white/80 md:text-base">
                {p.includes.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/35" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        ))}
      </div>

      <div id="guidance-request" className="scroll-mt-24">
        <Panel className="space-y-6 p-6 md:p-8">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
              Request guidance
            </h2>
            <div className="mt-3 max-w-xl space-y-3 text-sm leading-relaxed text-white/70 md:text-base">
              <p>No corporate pitch. Just real conversation.</p>
              <p>
                If this sounds like what you need, send us a note and we will
                take it from there.
              </p>
              <p className="text-white/55">
                Sign in to submit. Your name and email are pulled from your
                account so we can respond.
              </p>
              {profileHint ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60">
                  Submitting as: {profileHint}
                </p>
              ) : null}
            </div>
          </div>
          <GuidanceRequestForm plan={plan} onPlanChange={setPlan} />
        </Panel>
      </div>
    </section>
  );
}
