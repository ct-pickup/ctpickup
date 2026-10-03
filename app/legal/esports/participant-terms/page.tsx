import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsParticipantTermsDocument } from "@/lib/legal/esportsParticipantTermsDocument";
import { esportsDocVersionLabel } from "@/lib/legal/esportsDocVersions";

export const metadata: Metadata = {
  title: "Terms and Conditions (Esports) | Competitive Together",
  description: "Terms and conditions for the Competitive Together platform and esports registration.",
};

export default function EsportsParticipantTermsPage() {
  const v = esportsDocVersionLabel.participantTerms;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-caption text-muted">Version {v}</p>
      <h1 className="mt-3 text-h1 font-serif font-semibold text-ink md:text-display">
        Terms and Conditions
      </h1>
      <p className="mt-3 text-small text-muted">
        Platform, account, and registration — read with the Official Tournament Rules and the Privacy
        and Publicity Consent Policy.
      </p>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <EsportsParticipantTermsDocument />
        </Panel>

        <p className="text-center text-small text-muted">
          <Link href="/legal/esports" className="underline-offset-4 hover:underline">
            All esports legal documents
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
