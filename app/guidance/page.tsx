import { Suspense } from "react";
import { SupportEmailLink } from "@/components/SupportEmailLink";
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
    <div className="rounded-card border border-line bg-card px-6 py-12 text-center text-small text-muted">
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
          <SectionEyebrow>Competitive Together</SectionEyebrow>
          <h1 className="text-h1 font-serif font-semibold text-ink md:text-display md:leading-tight">
            Player Development
          </h1>
          <p className="max-w-2xl text-body font-medium leading-relaxed text-ink md:text-h3 font-serif">
            Real guidance from people who have lived it.
          </p>
        </header>

        <Panel className="space-y-4 p-6 md:p-8">
          <h2 className="text-small font-semibold text-muted">
            What this is
          </h2>
          <div className="space-y-3 text-small leading-relaxed text-ink md:text-body">
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
            <p className="pt-1 text-caption text-muted md:text-small">
              Not legal, medical, or licensed professional advice. An
              &quot;initial consultation&quot; means an informal conversation
              to align on fit — not a licensed service.
            </p>
          </div>
        </Panel>

        <Panel className="space-y-5 p-6 md:p-8">
          <h2 className="text-small font-semibold text-muted">
            What we help with
          </h2>
          <ul className="space-y-2">
            {WHAT_WE_HELP_WITH.map((item) => (
              <li
                key={item}
                className="flex gap-2 text-small leading-relaxed text-ink md:text-body"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-muted" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="space-y-4 p-6 md:p-8">
          <h2 className="text-small font-semibold text-muted">
            How it works
          </h2>
          <div className="space-y-3 text-small leading-relaxed text-ink md:text-body">
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
            <p className="text-muted">
              Optional: a short initial consultation (informal, not licensed)
              to line up on needs before deeper work.
            </p>
            <p className="pt-1 text-small text-muted md:text-body">
              Need help? Email{"  "}
              <SupportEmailLink className="font-medium text-ink underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-button" />
              .
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
