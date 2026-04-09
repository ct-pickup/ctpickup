import { Suspense } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { GuidancePlansAndRequest } from "./GuidancePlansAndRequest";

const WHAT_WE_HELP_WITH = [
  "Getting better and improving your game",
  "Understanding how competition works, from pickup to tournaments",
  "Thinking through your next steps as a player",
  "Exposure and opportunities, with a realistic perspective",
  "General advice when you are unsure where to start",
];

function PlansFallback() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-white/50">
      Loading plans…
    </div>
  );
}

export default function GuidancePage() {
  return (
    <PageShell maxWidthClass="max-w-4xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="space-y-10 pb-20 pt-4">
        <header className="space-y-4">
          <SectionEyebrow>CT Pickup</SectionEyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Player Development
          </h1>
          <p className="max-w-2xl text-base font-medium leading-relaxed text-white/85 md:text-xl">
            Real guidance from people who have lived it.
          </p>
        </header>

        <Panel className="space-y-4 p-6 md:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
            What this is
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-white/80 md:text-base">
            <p>This is not professional consulting or certified advising.</p>
            <p>
              It is real guidance from people who have firsthand experience
              competing, improving, and navigating the next steps in their
              journey.
            </p>
            <p>
              We offer straight, practical insight for players who want clarity,
              direction, and honest feedback — without the corporate language or
              empty hype.
            </p>
            <p className="pt-1 text-xs text-white/50 md:text-sm">
              Not legal, medical, or licensed professional advice. An
              &quot;initial consultation&quot; means an informal conversation
              to align on fit — not a licensed service.
            </p>
          </div>
        </Panel>

        <Panel className="space-y-5 p-6 md:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
            What we help with
          </h2>
          <ul className="space-y-2">
            {WHAT_WE_HELP_WITH.map((item) => (
              <li
                key={item}
                className="flex gap-2 text-sm leading-relaxed text-white/80 md:text-base"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/40" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="space-y-4 p-6 md:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
            How it works
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-white/80 md:text-base">
            <p>
              First, you reach out and tell us what you are trying to figure
              out.
            </p>
            <p>
              Then we connect you with the person from our side who best fits
              your situation.
            </p>
            <p>
              After that, you talk directly in the format that works best —
              message, call, or otherwise.
            </p>
            <p className="text-white/55">
              Optional: a short initial consultation (informal, not licensed)
              to line up on needs before deeper work.
            </p>
          </div>
        </Panel>

        <Suspense fallback={<PlansFallback />}>
          <GuidancePlansAndRequest />
        </Suspense>
      </div>
    </PageShell>
  );
}
