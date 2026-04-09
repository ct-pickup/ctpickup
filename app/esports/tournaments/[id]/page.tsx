import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsRegisterCtaButton } from "@/components/esports/EsportsRegisterCtaButton";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { fetchPublicEsportsTournamentById } from "@/lib/esports/fetchPublicEsportsTournamentById";

type Props = { params: Promise<{ id: string }> };

function fmtEt(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await fetchPublicEsportsTournamentById(id);
  if (!data) return { title: "Tournament | Esports | CT Pickup" };
  return {
    title: `${data.title} | Esports | CT Pickup`,
    description: data.description || `${data.game} — ${data.prize}`,
  };
}

export default async function EsportsTournamentDetailPage({ params }: Props) {
  const { id } = await params;
  const { data: t, error } = await fetchPublicEsportsTournamentById(id);
  if (error || !t) notFound();

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <EsportsSetupNudgeBar />

      <header className="mt-4">
        <SectionEyebrow>Esports</SectionEyebrow>
        <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
          {t.title}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/80">{t.game}</p>
      </header>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Overview</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Online EA SPORTS FC competition with scheduled rounds, proof-of-result requirements,
            and admin oversight. Field CT Pickup tournaments are separate.
          </p>
          {t.description ? (
            <p className="mt-4 text-sm leading-relaxed text-white/65">{t.description}</p>
          ) : null}
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Eligibility (summary)</h2>
          <ul className="mt-4 space-y-2 text-sm text-white/75">
            <li>At least 18 years old</li>
            <li>Legal U.S. resident, not a Connecticut resident</li>
            <li>Valid EA / console accounts and game access as described in the rules</li>
          </ul>
          <p className="mt-4 text-xs text-white/45">
            Full eligibility and enforcement are in the{" "}
            <Link
              href="/legal/esports/official-rules"
              className="text-[var(--brand)] underline-offset-4 hover:underline"
            >
              Official Tournament Rules
            </Link>
            .
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Prize</h2>
          <p className="mt-3 text-sm text-white/80">{t.prize}</p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Format (summary)</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Bracket-style play on the current EA SPORTS FC title with scheduled windows, required
            match reporting, and progressive elimination. Exact structure may vary by event—see
            rules for the full schedule model.
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Entry fee</h2>
          <p className="mt-3 text-sm text-white/80">
            <span className="font-semibold text-white">$10 per player</span> — non-refundable
            except where the Official Tournament Rules say otherwise.
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Legal documents</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link
                href="/legal/esports/official-rules"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Official Tournament Rules
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/participant-terms"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Terms and Conditions
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/privacy-publicity"
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Privacy and Publicity Consent Policy
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-xs uppercase tracking-[0.14em] text-white/45">
            Schedule (Eastern Time)
          </p>
          <p className="mt-2 text-sm text-white/70">
            {fmtEt(t.start_date)} — {fmtEt(t.end_date)}
          </p>

          <div className="mt-8 border-t border-white/10 pt-8">
            <EsportsRegisterCtaButton
              tournamentId={t.id}
              className="inline-flex w-full items-center justify-center rounded-md bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 sm:w-auto"
            >
              Register for this tournament
            </EsportsRegisterCtaButton>
            <p className="mt-3 text-xs text-white/45">
              Sign in required. You will review and sign legal documents before paying the entry fee.
            </p>
          </div>
        </Panel>
      </div>

      <p className="mt-8 text-center text-sm text-white/45">
        <Link href="/esports/tournaments" className="underline-offset-4 hover:underline">
          All tournaments
        </Link>
      </p>
    </PageShell>
  );
}
