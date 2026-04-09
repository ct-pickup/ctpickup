import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsTournamentRegistrationClient } from "@/components/esports/EsportsTournamentRegistrationClient";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { fetchPublicEsportsTournamentById } from "@/lib/esports/fetchPublicEsportsTournamentById";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await fetchPublicEsportsTournamentById(id);
  if (!data) return { title: "Register | Esports | CT Pickup" };
  return {
    title: `Register — ${data.title} | Esports | CT Pickup`,
    description: "Legal consent and entry fee for CT Pickup esports tournaments.",
  };
}

export default async function EsportsTournamentRegisterPage({ params }: Props) {
  const { id } = await params;
  const { data: tournament, error } = await fetchPublicEsportsTournamentById(id);
  if (error || !tournament) notFound();

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <EsportsSetupNudgeBar />

      <header className="mt-4">
        <SectionEyebrow>Esports registration</SectionEyebrow>
        <h1 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
          {tournament.title}
        </h1>
        <p className="mt-3 text-sm text-white/60">
          Consent, signature, and $10 entry. You must be signed in.{" "}
          <Link
            href={`/esports/tournaments/${tournament.id}`}
            className="text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Tournament overview
          </Link>
        </p>
      </header>

      <Panel className="mt-8 p-6 md:p-8">
        <Suspense
          fallback={<p className="text-sm text-white/60">Loading registration…</p>}
        >
          <EsportsTournamentRegistrationClient tournament={tournament} />
        </Suspense>
      </Panel>
    </PageShell>
  );
}
