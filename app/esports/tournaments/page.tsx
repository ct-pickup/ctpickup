import type { Metadata } from "next";
import { EmptyStateMessage } from "@/components/EmptyStateMessage";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { fetchPublicEsportsTournaments } from "@/lib/esports/fetchPublicEsportsTournaments";
import { APP_HOME_URL } from "@/lib/siteNav";

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
      <TopNav
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <header className="mt-4">
        <SectionEyebrow>Esports</SectionEyebrow>
        <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
          Esports Tournaments
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/72 md:text-lg md:leading-8">
          This hub is for{" "}
          <span className="text-white/90">EA SPORTS FC</span> competition
          online—brackets, schedules, and digital matchups. Each event uses a{" "}
          <span className="text-white/90">$10 buy-in per player</span>. It is
          separate from our outdoor team tournaments on the field.
        </p>
      </header>

      <section className="mt-10 md:mt-12">
        <Panel className="p-6 md:p-8">
          <SectionEyebrow>Events</SectionEyebrow>
          <h2 className="mt-4 text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            Upcoming & live
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60 md:text-base">
            Scheduled esports events and prize details. Status shows whether a
            tournament is open for registration or currently running.
          </p>

          {error ? (
            <EmptyStateMessage className="mt-8">
              Unable to load tournaments
            </EmptyStateMessage>
          ) : !data || data.length === 0 ? (
            <EmptyStateMessage className="mt-8">No tournaments available</EmptyStateMessage>
          ) : (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {data.map((t) => (
                <li
                  key={t.id}
                  className="rounded-xl border border-white/12 bg-white/[0.04] p-5 transition hover:border-white/18 hover:bg-white/[0.06]"
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
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </PageShell>
  );
}
