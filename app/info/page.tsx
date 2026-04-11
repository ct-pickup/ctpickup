"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { SupportEmailLink } from "@/components/SupportEmailLink";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";

type Section = {
  id: string;
  title: string;
  content: ReactNode;
};

export default function InfoPage() {
  const sections: Section[] = useMemo(
    () => [
      {
        id: "pickup",
        title: "Pickup",
        content: (
          <p className="whitespace-pre-line">
            {`C2 Pickup runs use a tiered invite system. This is a competitive environment, not casual.

If a run reaches capacity, you will be confirmed or placed on standby.

Standby players may be moved into Confirmed if spots open up.`}
          </p>
        ),
      },
      {
        id: "eligibility",
        title: "Eligibility",
        content: (
          <div className="space-y-3">
            <p className="whitespace-pre-line">
              {`Eligibility: College / Former College / ECNL / MLS Next / Varsity (or equivalent).`}
            </p>
            <p>
              If none, email <SupportEmailLink /> for a player referral. Most
              likely you can play, no promises.
            </p>
            <p>Minimum age: 16.</p>
          </div>
        ),
      },
      {
        id: "accounts",
        title: "Accounts",
        content: (
          <p className="whitespace-pre-line">
            {`Log in saves your info so you don’t re-enter it every time.

Signing in uses an 8-digit code sent to your email (no password).

It unlocks invite-only details (like exact location when confirmed).

It lets you see Confirmed vs Standby.

It lets you update your profile without DM’ing.`}
          </p>
        ),
      },
      {
        id: "tournaments",
        title: "Tournaments",
        content: (
          <p className="whitespace-pre-line">
            {`Captains and players must submit at least 48 hours before the tournament start time.

Team spots are limited. The Status Board updates as teams are approved/removed.

Minimum roster size is required to submit. Goalkeeper counts toward the total.`}
          </p>
        ),
      },
      {
        id: "submissions",
        title: "Submission Agreement",
        content: (
          <p className="whitespace-pre-line">
            {`When you click Make Submission, a required pop-up appears.

You must read each section, then check the box to confirm you read and agree before submitting.`}
          </p>
        ),
      },
      {
        id: "contact",
        title: "Contact",
        content: (
          <p>
            For questions, scheduling, or issues with the site:{" "}
            <SupportEmailLink />
          </p>
        ),
      },
    ],
    []
  );

  return (
    <PageShell>
      <TopNav
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
              <div className="text-sm leading-relaxed text-white/75">
                {sec.content}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
