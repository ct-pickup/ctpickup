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
import { KnockoutBracketDisplay } from "@/components/esports/KnockoutBracketDisplay";
import { fetchPublicEsportsTournamentById } from "@/lib/esports/fetchPublicEsportsTournamentById";
import { safeKnockoutBracket } from "@/lib/esports/knockoutBracket";

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

function DeadlineRow({ label, iso }: { label: string; iso: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
      <div className="text-sm font-medium text-white/85">{label}</div>
      <div className="text-sm text-white/70">{iso ? fmtEt(iso) : "TBD"}</div>
    </div>
  );
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
  const bracket = safeKnockoutBracket(t.knockout_bracket);

  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
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
          {t.format_summary ? (
            <p className="mt-3 text-sm leading-relaxed text-white/70">{t.format_summary}</p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Round robin group stage followed by a knockout bracket with clear deadlines.
              Tournament admins will publish the bracket after the group stage closes.
            </p>
          )}
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Schedule (Eastern Time)</h2>
          <div className="mt-4 space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/45">Group Stage</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Deadline 1 (first set of group matches)" iso={t.group_stage_deadline_1} />
                <DeadlineRow label="Deadline 2 (second set of group matches)" iso={t.group_stage_deadline_2} />
                <DeadlineRow label="Final deadline (all group results submitted)" iso={t.group_stage_final_deadline} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/45">Knockout Stage</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Knockout starts / bracket posted" iso={t.knockout_start_at} />
                <DeadlineRow label="Quarterfinal deadline" iso={t.quarterfinal_deadline} />
                <DeadlineRow label="Semifinal deadline" iso={t.semifinal_deadline} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/45">Final</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Final must be completed by" iso={t.final_deadline} />
              </div>
            </div>
            <p className="text-xs text-white/45">
              Overall window: {fmtEt(t.start_date)} — {fmtEt(t.end_date)}
            </p>
          </div>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Knockout bracket</h2>
          {bracket ? (
            <>
              <p className="mt-3 text-sm text-white/60">
                Rounds read left to right on desktop. The highlighted round is the first with an open match.
              </p>
              <div className="mt-6">
                <KnockoutBracketDisplay bracket={bracket} />
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-10 text-center">
              <p className="text-sm text-white/70">
                Knockout bracket will be posted after the group stage closes.
              </p>
              <p className="mt-2 text-xs text-white/45">Check back for matchups, deadlines, and results.</p>
            </div>
          )}
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
