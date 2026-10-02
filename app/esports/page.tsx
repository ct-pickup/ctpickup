import Link from "next/link";
import type { Metadata } from "next";
import { EsportsMark } from "@/components/esports/EsportsMark";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";

export const metadata: Metadata = {
  title: "Esports | CT Pickup",
  description:
    "EA SPORTS FC online tournaments: eligibility, $10 entry, legal consent, and brackets separate from outdoor CT Pickup events.",
};

export default function EsportsPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <EsportsSetupNudgeBar />

      <header className="mt-4 grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-center lg:gap-12">
        <div className="space-y-5">
          <SectionEyebrow>CT Pickup</SectionEyebrow>

          <h1 className="text-h1 font-serif font-semibold text-ink md:text-display">
            Esports
          </h1>

          <p className="max-w-xl text-small text-muted md:text-caption">
            EA SPORTS FC · Online tournaments · $10 entry
          </p>

          <p className="max-w-xl text-body leading-relaxed text-muted md:text-h3 font-serif md:leading-8">
            Browse schedules and tournament details anytime. Registering requires an account, full legal
            acceptance (typed signature), and payment of the{"  "}
            <span className="text-ink">$10 entry fee</span> (refund if you request more than 48 hours
            before the published start; no refund within 48 hours of start; full refund if the Organizer
            cancels before play—see Official Tournament Rules). Outdoor field tournaments are separate.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/esports/tournaments"
              className="inline-flex items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch transition hover:opacity-90"
            >
              View tournaments
            </Link>
            <Link
              href="/legal/esports"
              className="inline-flex items-center justify-center rounded-button border border-line px-5 py-3 text-small font-semibold text-ink transition hover:border-line hover:text-ink"
            >
              Read legal documents
            </Link>
          </div>
          <p className="text-caption text-muted">
            Registration is locked until you sign in—use Register on a tournament page after you review
            the rules.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-card border border-line bg-gradient-to-br from-ink via-card to-ink">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 80% 55% at 50% 28%, var(--overlay-strong), transparent 55%), radial-gradient(circle at 85% 75%, var(--overlay-subtle), transparent 45%)",
            }}
          />
          <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-5 px-8 py-12 md:min-h-[300px] md:py-16">
            <div className="rounded-card border border-line bg-overlay-strong p-8 backdrop-blur-sm md:p-10">
              <EsportsMark className="mx-auto h-28 w-28 text-ink md:h-36 md:w-36" />
            </div>
            <p className="text-center text-caption font-semibold text-muted">
              Competitive · Digital · CT Pickup
            </p>
          </div>
        </div>
      </header>

      <section className="mt-10 md:mt-14">
        <Panel className="p-6 md:p-8">
          <h2 className="text-small font-semibold text-ink">
            Legal documents
          </h2>
          <p className="mt-3 text-small leading-relaxed text-muted">
            Registration requires that you review and accept the Official Tournament Rules, the Terms
            and Conditions, and the Privacy and Publicity Consent Policy.
          </p>
          <Link
            href="/legal/esports"
            className="mt-3 inline-flex text-small font-medium text-pitch-text underline-offset-4 hover:underline"
          >
            View esports legal documents
          </Link>
        </Panel>
      </section>

      <section className="mt-8 scroll-mt-24 md:mt-10">
        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink md:text-h2">
            At a glance
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <li className="rounded-card border border-line bg-card p-5">
              <h3 className="text-small font-semibold text-ink">
                Eligibility
              </h3>
              <p className="mt-2 text-small leading-relaxed text-muted">
                18+, U.S. legal resident, not a Connecticut resident. EA account, console online access,
                and game ownership as required.
              </p>
            </li>
            <li className="rounded-card border border-line bg-card p-5">
              <h3 className="text-small font-semibold text-ink">Prize</h3>
              <p className="mt-2 text-small leading-relaxed text-muted">
                Cash prize for the winner as posted per event. See each tournament for the advertised
                amount.
              </p>
            </li>
            <li className="rounded-card border border-line bg-card p-5">
              <h3 className="text-small font-semibold text-ink">Format</h3>
              <p className="mt-2 text-small leading-relaxed text-muted">
                Bracket play on the current EA SPORTS FC title with scheduled windows and required
                result reporting. Details vary by event.
              </p>
            </li>
            <li className="rounded-card border border-line bg-card p-5">
              <h3 className="text-small font-semibold text-ink">Entry fee</h3>
              <p className="mt-2 text-small leading-relaxed text-muted">
                $10 per player, collected at registration after legal consent. Refunds only if requested
                more than 48 hours before the published start (see Official Tournament Rules).
              </p>
            </li>
          </ul>
        </Panel>
      </section>

      <section className="mt-6 md:mt-8">
        <Panel className="border border-line bg-card p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Full rules & policies</h2>
          <p className="mt-2 text-small text-muted">
            Registration records document version IDs, timestamp, account, and server audit fields.
          </p>
          <ul className="mt-5 flex flex-col gap-2 text-small">
            <li>
              <Link
                href="/legal/esports/official-rules"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Official Tournament Rules
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/participant-terms"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Terms and Conditions
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/privacy-publicity"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Privacy and Publicity Consent Policy
              </Link>
            </li>
          </ul>
        </Panel>
      </section>
    </PageShell>
  );
}
