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
  title: "Privacy & Publicity (Esports) | CT Pickup",
  description: "Privacy and publicity consent for CT Pickup esports tournaments.",
};

export default function EsportsPrivacyPublicityPage() {
  const v = esportsDocVersionLabel.privacyPublicity;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">
        Version {v} (draft — replace with final counsel-approved PDF/HTML)
      </p>
      <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Privacy and Publicity Consent Policy
      </h1>
      <p className="mt-3 text-sm text-white/60">Esports tournaments — results, streams, and media.</p>

      <div className="mt-8 space-y-6">
        <EsportsLegalReviewBlock />

        <Panel className="p-6 md:p-8">
          <div className="space-y-5 text-sm leading-relaxed text-white/78 md:text-[15px] md:leading-7">
            <section>
              <h2 className="text-base font-semibold text-white">1. What we collect</h2>
              <p className="mt-2">
                We collect account and registration information you submit (including your typed
                electronic signature name), tournament results, match proof you upload or link, and
                technical metadata needed to operate the site (for example IP address and user agent on
                consent submissions for audit logs).
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">2. How we use information</h2>
              <p className="mt-2">
                We use this information to operate tournaments, communicate schedules, verify results,
                process payments through our payment processor, and maintain integrity records.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">3. Publicity consent</h2>
              <p className="mt-2">
                By participating, you agree that CT Pickup and its media partners may display your
                gamertag, match outcomes, bracket position, and similar tournament-related content in
                live streams, replays, social posts, and promotional materials for the events you enter,
                without additional compensation beyond the tournament prize structure (if any) described
                in the Official Tournament Rules.
              </p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-white">4. Retention</h2>
              <p className="mt-2">
                Consent and payment audit fields may be retained for as long as needed to demonstrate
                what version of each document you accepted and whether your entry fee was processed.
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
