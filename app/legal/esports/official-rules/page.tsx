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
  title: "Official Tournament Rules (Esports) | CT Pickup",
  description: "Official rules for CT Pickup EA SPORTS FC online tournaments.",
};

export default function EsportsOfficialRulesPage() {
  const v = esportsDocVersionLabel.officialRules;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">
        Version {v} (draft — replace with final counsel-approved PDF/HTML)
      </p>
      <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Official Tournament Rules
      </h1>
      <p className="mt-3 text-sm text-white/60">EA SPORTS FC online tournaments operated by CT Pickup.</p>

      <div className="mt-8 space-y-6">
        <EsportsLegalReviewBlock />

        <Panel className="p-6 md:p-8">
          <div className="space-y-5 text-sm leading-relaxed text-white/78 md:text-[15px] md:leading-7">
            <section>
              <h2 className="text-base font-semibold text-white">1. Organizer</h2>
              <p className="mt-2">
                These rules govern CT Pickup esports events played on the current EA SPORTS FC title.
                The organizer may publish schedules, bracket instructions, and admin decisions on the
                website or designated channels.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">2. Eligibility</h2>
              <p className="mt-2">
                Players must be at least 18 years old, legal residents of the United States, and not
                residents of Connecticut. Players must own or lawfully access the game, maintain any
                required platform subscriptions (e.g., PlayStation Plus, Xbox Game Pass Core/online
                service as applicable), and use a valid EA account tied to their competition profile.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">3. Entry fee</h2>
              <p className="mt-2">
                Unless otherwise stated for a specific event, the entry fee is USD $10 per player,
                collected through the approved checkout flow. Entry fees are generally non-refundable
                except where these rules or applicable law require otherwise (for example, if an event
                is canceled by the organizer without a reschedule).
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">4. Competition integrity</h2>
              <p className="mt-2">
                Players must follow match settings announced for the event, submit required proof of
                results when instructed, and cooperate with admins on scheduling disputes. Cheating,
                account sharing to evade eligibility, harassment, or manipulation of results may result
                in disqualification without refund, as determined by the organizer in reasonable
                discretion.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">5. Dispute resolution (draft — legal review)</h2>
              <p className="mt-2">
                <span className="text-white/90">
                  Except where prohibited by law, any dispute arising out of or relating to these rules
                  or the tournament shall be resolved by binding arbitration administered by JAMS under
                  its applicable rules, and judgment on the award may be entered in any court of
                  competent jurisdiction. The seat of arbitration shall be Hartford County,
                  Connecticut.
                </span>{" "}
                This section is flagged for alignment with the Participant Terms—see the legal review
                notice on the esports legal index.
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
