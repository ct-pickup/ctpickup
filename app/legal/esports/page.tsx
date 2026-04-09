import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsLegalReviewBlock } from "@/components/legal/EsportsLegalReviewBlock";

export const metadata: Metadata = {
  title: "Esports legal documents | CT Pickup",
  description: "Official Tournament Rules, Participant Terms, and Privacy & Publicity for CT Pickup esports.",
};

export default function EsportsLegalIndexPage() {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} gateProtectedNav={false} />
      <h1 className="mt-6 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Esports legal documents
      </h1>
      <p className="mt-4 text-sm text-white/65">
        Source copies for registration. Version identifiers are recorded when you sign.
      </p>

      <div className="mt-8 space-y-6">
        <EsportsLegalReviewBlock />

        <Panel className="p-6 md:p-8">
          <ul className="space-y-4 text-sm">
            <li>
              <Link
                href="/legal/esports/official-rules"
                className="font-semibold text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Official Tournament Rules
              </Link>
              <p className="mt-1 text-white/60">Competition structure, eligibility, and dispute resolution (draft).</p>
            </li>
            <li>
              <Link
                href="/legal/esports/participant-terms"
                className="font-semibold text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Terms and Conditions
              </Link>
              <p className="mt-1 text-white/60">Participant agreement for digital tournaments (draft).</p>
            </li>
            <li>
              <Link
                href="/legal/esports/privacy-publicity"
                className="font-semibold text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Privacy and Publicity Consent Policy
              </Link>
              <p className="mt-1 text-white/60">Data use, streaming, and results publicity (draft).</p>
            </li>
          </ul>
        </Panel>
      </div>
    </PageShell>
  );
}
