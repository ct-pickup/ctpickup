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
  title: "Esports Tournaments | CT Pickup",
  description:
    "EA SPORTS FC online tournaments—$10 buy-in per player, brackets, schedules, and competition separate from outdoor CT Pickup events.",
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
        <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
          Esports Tournaments
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/72 md:text-lg md:leading-8">
          Browse events below. Open a tournament for eligibility, prize, format, and legal links.{" "}
          <span className="text-white/90">Register</span> requires an account, full legal acceptance, and
          the $10 entry fee.
        </p>
      </header>

      <section className="mt-10 md:mt-12">
        <Panel className="p-6 md:p-8">
          <SectionEyebrow>Events</SectionEyebrow>
          <h2 className="mt-4 text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            Upcoming & live
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60 md:text-base">
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
                  className="flex flex-col rounded-xl border border-white/12 bg-white/[0.04] p-5 transition hover:border-white/18 hover:bg-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold tracking-tight text-white md:text-lg">
                      {t.title}
                    </h3>
                    <span className="shrink-0 rounded-full border border-[var(--brand)]/35 bg-[var(--brand)]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand)]">
                      {statusLabel(t.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white/80">{t.game}</p>
                  <p className="mt-3 text-sm text-white/65">
                    <span className="font-semibold text-white/85">Prize:</span> {t.prize}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-white/45">
                    Dates (ET)
                  </p>
                  <p className="mt-1 text-sm text-white/70">
                    {fmtEt(t.start_date)} — {fmtEt(t.end_date)}
                  </p>
                  {t.description ? (
                    <p className="mt-4 text-sm leading-relaxed text-white/60">{t.description}</p>
                  ) : null}
                  <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      href={`/esports/tournaments/${t.id}`}
                      className="inline-flex items-center justify-center rounded-md border border-white/18 px-4 py-2.5 text-center text-sm font-semibold text-white/90 transition hover:border-white/30 hover:bg-white/[0.04]"
                    >
                      Details
                    </Link>
                    <EsportsRegisterCtaButton
                      tournamentId={t.id}
                      className="inline-flex items-center justify-center rounded-md bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
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
