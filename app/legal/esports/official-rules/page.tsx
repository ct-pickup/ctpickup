import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsOfficialRulesDocument } from "@/lib/legal/esportsOfficialRulesDocument";
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
      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/45">Version {v}</p>
      <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Official Tournament Rules
      </h1>
      <p className="mt-3 text-sm text-white/60">
        EA SPORTS FC 26 online tournaments — read with the Terms and Conditions and the Privacy and
        Publicity Consent Policy (see Section 0).
      </p>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <EsportsOfficialRulesDocument />
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
