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

          <h1 className="text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
            Esports
          </h1>

          <p className="max-w-xl text-sm uppercase tracking-[0.2em] text-white/55 md:text-xs md:tracking-[0.24em]">
            EA SPORTS FC · Online tournaments · $10 entry
          </p>

          <p className="max-w-xl text-base leading-relaxed text-white/78 md:text-lg md:leading-8">
            Browse schedules and tournament details anytime. Registering requires an account, full legal
            acceptance (typed signature), and payment of the{" "}
            <span className="text-white/90">$10 non-refundable entry fee</span> except where the rules
            say otherwise. Outdoor field tournaments are separate.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/esports/tournaments"
              className="inline-flex items-center justify-center rounded-md bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
            >
              View tournaments
            </Link>
            <Link
              href="/legal/esports"
              className="inline-flex items-center justify-center rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/35 hover:text-white"
            >
              Read legal documents
            </Link>
          </div>
          <p className="text-xs text-white/45">
            Registration is locked until you sign in—use Register on a tournament page after you review
            the rules.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-white/[0.07] via-[#141415] to-black/90 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.55)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 80% 55% at 50% 28%, rgba(34,197,94,0.14), transparent 55%), radial-gradient(circle at 85% 75%, rgba(255,255,255,0.04), transparent 45%)",
            }}
          />
          <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-5 px-8 py-12 md:min-h-[300px] md:py-16">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm md:p-10">
              <EsportsMark className="mx-auto h-28 w-28 text-white md:h-36 md:w-36" />
            </div>
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">
              Competitive · Digital · CT Pickup
            </p>
          </div>
        </div>
      </header>

      <section className="mt-10 md:mt-14">
        <Panel className="p-6 md:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/85">
            Legal documents
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/65">
            Registration requires that you review and accept the Official Tournament Rules, the Terms
            and Conditions, and the Privacy and Publicity Consent Policy.
          </p>
          <Link
            href="/legal/esports"
            className="mt-3 inline-flex text-sm font-medium text-[var(--brand)] underline-offset-4 hover:underline"
          >
            View esports legal documents
          </Link>
        </Panel>
      </section>

      <section className="mt-8 scroll-mt-24 md:mt-10">
        <Panel className="p-6 md:p-8">
          <h2 className="text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            At a glance
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <li className="rounded-xl border border-white/12 bg-white/[0.04] p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/90">
                Eligibility
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                18+, U.S. legal resident, not a Connecticut resident. EA account, console online access,
                and game ownership as required.
              </p>
            </li>
            <li className="rounded-xl border border-white/12 bg-white/[0.04] p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/90">Prize</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                Cash prize for the winner as posted per event. See each tournament for the advertised
                amount.
              </p>
            </li>
            <li className="rounded-xl border border-white/12 bg-white/[0.04] p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/90">Format</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                Bracket play on the current EA SPORTS FC title with scheduled windows and required
                result reporting. Details vary by event.
              </p>
            </li>
            <li className="rounded-xl border border-white/12 bg-white/[0.04] p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/90">Entry fee</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                $10 per player, collected at registration after legal consent. Non-refundable except where
                the Official Tournament Rules say otherwise.
              </p>
            </li>
          </ul>
        </Panel>
      </section>

      <section className="mt-6 md:mt-8">
        <Panel className="border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Full rules & policies</h2>
          <p className="mt-2 text-sm text-white/60">
            Registration records document version IDs, timestamp, account, and server audit fields.
          </p>
          <ul className="mt-5 flex flex-col gap-2 text-sm">
            <li>
              <Link
                href="/legal/esports/official-rules"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Official Tournament Rules
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/participant-terms"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Terms and Conditions
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/privacy-publicity"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
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
