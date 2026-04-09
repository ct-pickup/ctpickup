import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsLegalReviewBlock } from "@/components/legal/EsportsLegalReviewBlock";
import { esportsDocVersionLabel } from "@/lib/legal/esportsDocVersions";

export const metadata: Metadata = {
  title: "Participant Terms (Esports) | CT Pickup",
  description: "Terms and conditions for CT Pickup esports tournament participants.",
};

export default function EsportsParticipantTermsPage() {
  const v = esportsDocVersionLabel.participantTerms;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">
        Version {v} (draft — replace with final counsel-approved PDF/HTML)
      </p>
      <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Terms and Conditions
      </h1>
      <p className="mt-3 text-sm text-white/60">Esports tournament participants (digital / EA SPORTS FC).</p>

      <div className="mt-8 space-y-6">
        <EsportsLegalReviewBlock />

        <Panel className="p-6 md:p-8">
          <div className="space-y-5 text-sm leading-relaxed text-white/78 md:text-[15px] md:leading-7">
            <section>
              <h2 className="text-base font-semibold text-white">1. Agreement</h2>
              <p className="mt-2">
                By registering and paying the entry fee, you agree to these Terms, the Official
                Tournament Rules, the Privacy and Publicity Consent Policy, and the general CT Pickup
                Liability Waiver where applicable to platform use.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">2. Accounts and conduct</h2>
              <p className="mt-2">
                You are responsible for your platform accounts, gamertag, connectivity, and hardware.
                You will not engage in harassment, hate speech, cheating, or conduct that undermines
                fair play. The organizer may remove you from an event for serious violations.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">3. Publicity</h2>
              <p className="mt-2">
                You consent to the use of your gamertag, match results, and related tournament content
                as described in the Privacy and Publicity Consent Policy, including for streams,
                highlights, and social posts.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">4. Governing law & venue (draft — legal review)</h2>
              <p className="mt-2">
                <span className="text-white/90">
                  These Terms are governed by the laws of the State of Connecticut, without regard to
                  conflict-of-law rules. You agree that exclusive venue for any court proceeding
                  arising from these Terms or your participation shall lie in the state or federal
                  courts located in Connecticut.
                </span>{" "}
                This section is flagged for alignment with the Official Tournament Rules—see the legal
                review notice on the esports legal index.
              </p>
            </section>
          </div>
        </Panel>

        <p className="text-center text-sm text-white/45">
          <Link href="/legal/esports" className="underline-offset-4 hover:underline">
            All esports legal documents
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
