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
import { SupportEmailLink } from "@/components/SupportEmailLink";
import { EsportsTournamentRegisterSection } from "@/components/esports/EsportsTournamentRegisterSection";
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
      <div className="text-small font-medium text-ink">{label}</div>
      <div className="text-small text-muted">{iso ? fmtEt(iso) : "TBD"}</div>
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
        <h1 className="mt-4 text-h1 font-serif font-semibold text-ink md:text-display">
          {t.title}
        </h1>
        <p className="mt-2 text-small font-medium text-ink">{t.game}</p>
      </header>

      <div className="mt-8 space-y-6">
        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Overview</h2>
          <p className="mt-3 text-small leading-relaxed text-muted">
            Online EA SPORTS FC competition with scheduled rounds, proof-of-result requirements,
            and admin oversight. Field CT Pickup tournaments are separate.
          </p>
          {t.description ? (
            <p className="mt-4 text-small leading-relaxed text-muted">{t.description}</p>
          ) : null}
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Eligibility (summary)</h2>
          <ul className="mt-4 space-y-2 text-small text-muted">
            <li>At least 18 years old</li>
            <li>Legal U.S. resident, not a Connecticut resident</li>
            <li>Valid EA / console accounts and game access as described in the rules</li>
          </ul>
          <p className="mt-4 text-caption text-muted">
            Full eligibility and enforcement are in the{"  "}
            <Link
              href="/legal/esports/official-rules"
              className="text-pitch-text underline-offset-4 hover:underline"
            >
              Official Tournament Rules
            </Link>
            .
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Prize</h2>
          <p className="mt-3 text-small text-ink">{t.prize}</p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Format (summary)</h2>
          {t.format_summary ? (
            <p className="mt-3 text-small leading-relaxed text-muted">{t.format_summary}</p>
          ) : (
            <p className="mt-3 text-small leading-relaxed text-muted">
              Round robin group stage followed by a knockout bracket with clear deadlines.
              Tournament admins will publish the bracket after the group stage closes.
            </p>
          )}
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Schedule (Eastern Time)</h2>
          <div className="mt-4 space-y-6">
            <div>
              <p className="text-caption text-muted">Group Stage</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Deadline 1 (first set of group matches)" iso={t.group_stage_deadline_1} />
                <DeadlineRow label="Deadline 2 (second set of group matches)" iso={t.group_stage_deadline_2} />
                <DeadlineRow label="Final deadline (all group results submitted)" iso={t.group_stage_final_deadline} />
              </div>
            </div>
            <div>
              <p className="text-caption text-muted">Knockout Stage</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Knockout starts / bracket posted" iso={t.knockout_start_at} />
                <DeadlineRow label="Quarterfinal deadline" iso={t.quarterfinal_deadline} />
                <DeadlineRow label="Semifinal deadline" iso={t.semifinal_deadline} />
              </div>
            </div>
            <div>
              <p className="text-caption text-muted">Final</p>
              <div className="mt-3 space-y-3">
                <DeadlineRow label="Final must be completed by" iso={t.final_deadline} />
              </div>
            </div>
            <p className="text-caption text-muted">
              Overall window: {fmtEt(t.start_date)} — {fmtEt(t.end_date)}
            </p>
          </div>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Knockout bracket</h2>
          {bracket ? (
            <>
              <p className="mt-3 max-w-2xl text-small leading-relaxed text-muted">
                Single elimination: each column is one round (for example Round of 16 through Final). On larger screens,
                rounds flow left to right; on mobile they appear in order top to bottom. The highlighted round is the
                first one that still has a match without a winner.
              </p>
              <div
                className="mt-6 rounded-card border border-line bg-overlay-strong p-4 md:p-6"
                role="region"
                aria-label="Knockout bracket"
              >
                <KnockoutBracketDisplay bracket={bracket} />
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-card border border-dashed border-line bg-overlay-subtle px-5 py-10 text-center">
              <p className="text-small text-muted">
                Knockout bracket will be posted after the group stage closes.
              </p>
              <p className="mt-2 text-caption text-muted">Check back for matchups, deadlines, and results.</p>
            </div>
          )}
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Entry fee</h2>
          <p className="mt-3 text-small text-ink">
            <span className="font-semibold text-ink">$10 per player</span> — refund if you request more
            than 48 hours before the published tournament start; no refund within 48 hours of start; full
            refund if the Organizer cancels before play (
            <Link href="/legal/esports/official-rules#refund-policy" className="underline-offset-4 hover:underline">
              rules §9
            </Link>
            ).
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <h2 className="text-h3 font-serif font-semibold text-ink">Legal documents</h2>
          <ul className="mt-4 space-y-2 text-small">
            <li>
              <Link
                href="/legal/esports/official-rules"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Official Tournament Rules
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/participant-terms"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Terms and Conditions
              </Link>
            </li>
            <li>
              <Link
                href="/legal/esports/privacy-publicity"
                className="text-pitch-text underline-offset-4 hover:underline"
              >
                Privacy and Publicity Consent Policy
              </Link>
            </li>
          </ul>

          <p className="mt-6 text-small leading-relaxed text-muted">
            Questions? Email{"  "}
            <SupportEmailLink className="font-medium text-pitch-text underline-offset-4 hover:underline" />.
          </p>

          <EsportsTournamentRegisterSection
            tournamentId={t.id}
            buttonClassName="inline-flex w-full items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch transition hover:opacity-90 sm:w-auto"
          />
        </Panel>
      </div>

      <p className="mt-8 text-center text-small text-muted">
        <Link href="/esports/tournaments" className="underline-offset-4 hover:underline">
          All tournaments
        </Link>
      </p>
    </PageShell>
  );
}
