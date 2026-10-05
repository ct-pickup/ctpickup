import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthenticatedProfileMenu, HistoryBack, PageShell, Panel, TopNav } from "@/components/layout";
import { POINTS } from "@/lib/pickup/points";
import { isSeasonPrizeEnabled, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_RULES_VERSION, SEASON_PRIZE_USD, seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { APPLE_DISCLAIMER, seasonRuleSections, splitPlaceholders } from "@/shared/seasonRules";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Season Prize Official Rules (Draft) | Competitive Together",
  description: "Official rules for the Competitive Together season prize. Draft, pending legal review.",
};

const TODO = "rounded bg-card px-1 font-medium text-ink ring-1 ring-line";

/** Text with its [BRACKET] placeholders highlighted so none can be missed. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((part, i) =>
        part.placeholder ? (
          <span key={i} className={TODO}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export default function SeasonRulesPage() {
  if (!isSeasonPrizeEnabled()) notFound();
  const season = seasonWindowFor();
  const sections = seasonRuleSections({
    prizeUsd: SEASON_PRIZE_USD,
    minGames: SEASON_PRIZE_MIN_GAMES,
    points: POINTS,
    season: { label: season.label, startText: season.startText, endText: season.endText },
    rulesVersion: SEASON_PRIZE_RULES_VERSION,
  });

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <div className="mt-4">
        <HistoryBack
          fallbackHref="/"
          className="cursor-pointer border-0 bg-transparent p-0 text-small text-muted transition hover:text-ink"
        />
      </div>
      <h1 className="mt-6 text-h1 font-serif font-semibold text-ink md:text-display">Season Prize: Official Rules</h1>
      <p className="mt-2 text-small text-muted">Rules version {SEASON_PRIZE_RULES_VERSION}</p>

      <div className="mt-4 rounded-lg border border-line bg-card p-4 text-small text-ink" role="note">
        <strong>Draft, pending legal review.</strong> These rules are not final. Items in{" "}
        <span className={TODO}>[BRACKETS]</span> are still to be filled in.
      </div>
      <p className="mt-4 text-small font-medium text-ink">{APPLE_DISCLAIMER}</p>

      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-8 text-small leading-relaxed text-muted md:text-body">
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2 className="text-body font-semibold text-ink">{s.title}</h2>
              {s.blocks.map((b, i) =>
                b.kind === "p" ? (
                  <p key={i} className="mt-3">
                    <Rich text={b.text} />
                  </p>
                ) : b.kind === "link" ? (
                  <p key={i} className="mt-3">
                    <Link href={b.path} className="font-medium text-ink underline">
                      {b.label}
                    </Link>
                  </p>
                ) : (
                  <ul key={i} className="mt-3 list-disc space-y-1 pl-5">
                    {b.items.map((it) => (
                      <li key={it}>
                        <Rich text={it} />
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </section>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
