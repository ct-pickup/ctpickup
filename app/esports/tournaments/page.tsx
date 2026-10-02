import type { Metadata } from "next";
import Link from "next/link";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import { EsportsRegisterCtaButton } from "@/components/esports/EsportsRegisterCtaButton";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { fetchPublicEsportsTournaments } from "@/lib/esports/fetchPublicEsportsTournaments";

export const metadata: Metadata = {
  title: "Esports Tournaments | Competitive Together",
  description:
    "EA SPORTS FC online tournaments—$10 buy-in per player, brackets, schedules, and competition separate from outdoor Competitive Together events.",
};

export const dynamic = "force-dynamic";

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

function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "upcoming") return "Upcoming";
  return status;
}

export default async function EsportsTournamentsPage() {
  const { data, error } = await fetchPublicEsportsTournaments();

  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <EsportsSetupNudgeBar />

      <header className="mt-4">
        <SectionEyebrow>Esports</SectionEyebrow>
        <h1 className="mt-4 text-h1 font-serif font-semibold text-ink md:text-display">
          Esports Tournaments
        </h1>
        <p className="mt-4 max-w-2xl text-body leading-relaxed text-muted md:text-h3 font-serif md:leading-8">
          Browse events below. Open a tournament for eligibility, prize, format, and legal links.{"  "}
          <span className="text-ink">Register</span> requires an account, full legal acceptance, and
          the $10 entry fee.
        </p>
      </header>

      <section className="mt-10 md:mt-12">
        <Panel className="p-6 md:p-8">
          <SectionEyebrow>Events</SectionEyebrow>
          <h2 className="mt-4 text-h3 font-serif font-semibold text-ink md:text-h2">
            Upcoming & live
          </h2>
          <p className="mt-3 max-w-2xl text-small leading-relaxed text-muted md:text-body">
            Status shows whether registration is open or the event is running. Completed tournaments are
            not listed here.
          </p>

          {error ? (
            <EmptyStateMessage className="mt-8">Unable to load tournaments</EmptyStateMessage>
          ) : !data || data.length === 0 ? (
            <EmptyStateMessage className="mt-8">No tournaments available</EmptyStateMessage>
          ) : (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {data.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col rounded-card border border-line bg-card p-5 transition hover:border-line hover:bg-overlay"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-body font-semibold text-ink md:text-h3 font-serif">
                      {t.title}
                    </h3>
                    <span className="shrink-0 rounded-pill border border-[var(--brand)]/35 bg-[var(--brand)]/10 px-2.5 py-0.5 text-micro font-semibold text-pitch-text">
                      {statusLabel(t.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-small font-medium text-ink">{t.game}</p>
                  <p className="mt-3 text-small text-muted">
                    <span className="font-semibold text-ink">Prize:</span> {t.prize}
                  </p>
                  <p className="mt-2 text-caption text-muted">
                    Dates (ET)
                  </p>
                  <p className="mt-1 text-small text-muted">
                    {fmtEt(t.start_date)} — {fmtEt(t.end_date)}
                  </p>
                  {t.description ? (
                    <p className="mt-4 text-small leading-relaxed text-muted">{t.description}</p>
                  ) : null}
                  <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      href={`/esports/tournaments/${t.id}`}
                      className="inline-flex items-center justify-center rounded-button border border-line px-4 py-2.5 text-center text-small font-semibold text-ink transition hover:border-line hover:bg-overlay-subtle"
                    >
                      Details
                    </Link>
                    <EsportsRegisterCtaButton
                      tournamentId={t.id}
                      className="inline-flex items-center justify-center rounded-button bg-pitch px-4 py-2.5 text-small font-semibold text-on-pitch transition hover:opacity-90"
                    >
                      Register
                    </EsportsRegisterCtaButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </PageShell>
  );
}
