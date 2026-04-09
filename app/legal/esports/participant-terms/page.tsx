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
  title: "Terms and Conditions (Esports) | CT Pickup",
  description: "Terms and conditions for the CT Pickup platform and esports registration.",
};

export default function EsportsParticipantTermsPage() {
  const v = esportsDocVersionLabel.participantTerms;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">Version {v}</p>
      <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Terms and Conditions
      </h1>
      <p className="mt-3 text-sm text-white/60">
        Platform, account, and registration — read with the Official Tournament Rules and the Privacy
        and Publicity Consent Policy.
      </p>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <EsportsParticipantTermsDocument />
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
