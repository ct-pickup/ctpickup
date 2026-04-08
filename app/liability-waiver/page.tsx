import type { Metadata } from "next";
import Link from "next/link";
import { WaiverDocumentBody } from "@/components/waiver/WaiverDocumentBody";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { LiabilityWaiverReturnBack } from "@/components/waiver/LiabilityWaiverReturnBack";
import { APP_HOME_URL } from "@/lib/siteNav";
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
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <LiabilityWaiverReturnBack returnTo={returnTo} />

      <header className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
          Version {CURRENT_WAIVER_VERSION}
        </p>
        <h1 className="mt-3 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
          Liability Waiver &amp; Participation Agreement
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/65 md:text-base">
          By using this platform or participating in any activities connected to it
          — including pickup games, scrimmages, informal matches, tournaments, training,
          guidance, or any other activities related to soccer or association football —
          you agree to the following:
        </p>
      </header>

      <Panel className="mt-8 p-6 md:p-8">
        <WaiverDocumentBody />
      </Panel>

      <p className="mt-8 text-center text-sm text-white/45">
        Questions? Visit{" "}
        <Link href="/help" className="text-white/70 underline-offset-4 hover:underline">
          Help
        </Link>
        .
      </p>
    </PageShell>
  );
}
