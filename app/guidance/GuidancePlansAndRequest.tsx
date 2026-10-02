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
        <h2 className="text-small font-semibold text-muted">
          Player development plans
        </h2>
        <p className="mt-2 max-w-2xl text-small leading-relaxed text-muted">
          Choose the level of support that fits your goals. Final pricing and
          details are confirmed with you before anything moves forward.
        </p>
      </div>

      <div className="grid gap-5 lg:gap-6">
        {GUIDANCE_PLAN_DEFINITIONS.map((p) => (
          <Panel
            key={p.key}
            className="flex flex-col border-line p-6 md:p-8 lg:min-h-0"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div>
                <h3 className="text-h3 font-serif font-semibold text-ink md:text-h2">
                  {p.title}
                </h3>
                <p className="mt-1 text-caption font-medium text-muted">
                  Experience-based guidance — not licensed professional advising
                </p>
              </div>
              <div className="text-right">
                <div className="text-h2 font-serif font-semibold tabular-nums text-ink md:text-h1">
                  {formatGuidancePriceUsd(p.priceUsd)}
                </div>
                <div className="text-caption text-muted">Starting at</div>
              </div>
            </div>

            <p className="mt-4 text-small leading-relaxed text-muted md:text-body">
              {p.description}
            </p>

            <div className="mt-5 flex-1">
              <p className="text-caption font-semibold text-muted">
                Includes
              </p>
              <ul className="mt-3 space-y-2.5 text-small leading-relaxed text-ink md:text-body">
                {p.includes.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-muted" />
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
            <h2 className="text-small font-semibold text-muted">
              Request guidance
            </h2>
            <div className="mt-3 max-w-xl space-y-3 text-small leading-relaxed text-muted md:text-body">
              <p>No corporate pitch. Just real conversation.</p>
              <p>
                If this sounds like what you need, send us a note and we will
                take it from there.
              </p>
              <p className="text-muted">
                Sign in to submit. Your name and email are pulled from your
                account so we can respond.
              </p>
              {profileHint ? (
                <p className="rounded-button border border-line bg-overlay-subtle px-3 py-2 text-caption text-muted">
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
