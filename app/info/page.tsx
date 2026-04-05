"use client";

import { useMemo } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";

type Section = {
  id: string;
  title: string;
  text: string;
};

export default function InfoPage() {
  const sections: Section[] = useMemo(
    () => [
      {
        id: "pickup",
        title: "Pickup",
        text:
          "C2 Pickup runs use a tiered invite system. This is a competitive environment, not casual.\n\nIf a run reaches capacity, you will be confirmed or placed on standby.\n\nStandby players may be moved into Confirmed if spots open up.",
      },
      {
        id: "eligibility",
        title: "Eligibility",
        text:
          "Eligibility: College / Former College / ECNL / MLS Next / Varsity (or equivalent).\n\nIf none, email pickupct@gmail.com for a player referral. Most likely you can play, no promises.\n\nMinimum age: 16.",
      },
      {
        id: "accounts",
        title: "Accounts",
        text:
          "Log in saves your info so you don’t re-enter it every time.\n\n" +
          "It unlocks invite-only details (like exact location when confirmed).\n\n" +
          "It lets you see Confirmed vs Standby.\n\n" +
          "It lets you update your profile without DM’ing.",
      },
      {
        id: "tournaments",
        title: "Tournaments",
        text:
          "Captains and players must submit at least 48 hours before the tournament start time.\n\nTeam spots are limited. The Status Board updates as teams are approved/removed.\n\nMinimum roster size is required to submit. Goalkeeper counts toward the total.",
      },
      {
        id: "submissions",
        title: "Submission Agreement",
        text:
          "When you click Make Submission, a required pop-up appears.\n\nYou must read each section, then check the box to confirm you read and agree before submitting.",
      },
      {
        id: "contact",
        title: "Contact",
        text: "For questions, scheduling, or issues with the site: pickupct@gmail.com",
      },
    ],
    []
  );

  return (
    <PageShell>
      <TopNav
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="space-y-8 pb-16 pt-4">
        <div>
          <SectionEyebrow>Reference</SectionEyebrow>
          <h1 className="mt-3 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
            Info
          </h1>
        </div>

        <Panel className="space-y-3">
          <SectionEyebrow>Quick Find</SectionEyebrow>

          <div className="flex flex-wrap gap-2 pt-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 transition hover:text-white"
              >
                {s.title}
              </a>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          {sections.map((sec) => (
            <Panel key={sec.id} id={sec.id} className="scroll-mt-24 space-y-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide text-white">
                {sec.title}
              </h2>
              <div className="whitespace-pre-line text-sm leading-relaxed text-white/75">
                {sec.text}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
