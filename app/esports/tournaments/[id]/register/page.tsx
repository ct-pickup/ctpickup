import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { EsportsRegisterPageHeader } from "@/components/esports/EsportsRegisterPageHeader";
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

      <EsportsRegisterPageHeader tournamentId={tournament.id} tournamentTitle={tournament.title} />

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
