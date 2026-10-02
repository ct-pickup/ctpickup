import type { Metadata } from "next";
import Link from "next/link";
import { WaiverDocumentBody } from "@/components/waiver/WaiverDocumentBody";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { SupportEmailLink } from "@/components/SupportEmailLink";
import { LiabilityWaiverReturnBack } from "@/components/waiver/LiabilityWaiverReturnBack";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import { safeWaiverReturnTo } from "@/lib/waiver/safeReturnTo";

export const metadata: Metadata = {
  title: "Liability Waiver | CT Pickup",
  description:
    "Liability Waiver & Participation Agreement for CT Pickup soccer and association football activities, including pickup games, tournaments, training, and guidance.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LiabilityWaiverPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const raw = sp.returnTo;
  const returnToRaw = Array.isArray(raw) ? raw[0] : raw;
  const returnTo = safeWaiverReturnTo(returnToRaw ?? null);

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <LiabilityWaiverReturnBack returnTo={returnTo} />

      <header className="mt-6">
        <p className="text-caption font-semibold text-muted">
          Version {CURRENT_WAIVER_VERSION}
        </p>
        <h1 className="mt-3 text-h1 font-serif font-semibold text-ink md:text-display">
          Liability Waiver &amp; Participation Agreement
        </h1>
        <p className="mt-4 text-small leading-relaxed text-muted md:text-body">
          By using this platform or participating in any activities connected to it
          — including pickup games, scrimmages, informal matches, tournaments, training,
          guidance, or any other activities related to soccer or association football —
          you agree to the following:
        </p>
      </header>

      <Panel className="mt-8 p-6 md:p-8">
        <WaiverDocumentBody />
      </Panel>

      <p className="mt-8 text-center text-small text-muted">
        Questions? Visit{"  "}
        <Link href="/help" className="text-muted underline-offset-4 hover:underline">
          Help
        </Link>{"  "}
        or email{"  "}
        <SupportEmailLink className="text-muted underline underline-offset-4 hover:text-ink" />
        .
      </p>
    </PageShell>
  );
}
