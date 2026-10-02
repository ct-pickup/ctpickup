import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsPrivacyPublicityDocument } from "@/lib/legal/esportsPrivacyPublicityDocument";
import { esportsDocVersionLabel } from "@/lib/legal/esportsDocVersions";

export const metadata: Metadata = {
  title: "Privacy & Publicity (Esports) | Competitive Together",
  description: "Privacy and publicity consent for Competitive Together esports tournaments.",
};

export default function EsportsPrivacyPublicityPage() {
  const v = esportsDocVersionLabel.privacyPublicity;
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <p className="mt-4 text-caption text-muted">Version {v}</p>
      <h1 className="mt-3 text-h1 font-serif font-semibold text-ink md:text-display">
        Privacy and Publicity Consent Policy
      </h1>
      <p className="mt-3 text-small text-muted">
        Data use and publicity — read with the Terms and Conditions and the Official Tournament Rules.
      </p>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <EsportsPrivacyPublicityDocument />
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
