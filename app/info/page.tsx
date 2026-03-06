"use client";

import Link from "next/link";
import { useMemo } from "react";

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
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">INFO</h1>
          <Link href="/" className="text-sm underline text-white/80">
            Back
          </Link>
        </div>

        {/* QUICK FIND (tabs only) */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            Quick Find
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-xs rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/75 hover:text-white"
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {sections.map((sec) => (
            <section
              key={sec.id}
              id={sec.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 space-y-3"
            >
              <div className="text-lg font-semibold uppercase tracking-wide text-white/90">
                {sec.title}
              </div>
              <div className="text-white/75 whitespace-pre-line">{sec.text}</div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}