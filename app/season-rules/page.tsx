import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthenticatedProfileMenu, HistoryBack, PageShell, Panel, TopNav } from "@/components/layout";
import { POINTS } from "@/lib/pickup/points";
import { isSeasonPrizeEnabled, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_RULES_VERSION, SEASON_PRIZE_USD, seasonWindowFor } from "@/lib/pickup/seasonPrize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Season Prize Official Rules (Draft) | Competitive Together",
  description: "Official rules for the Competitive Together season prize. Draft, pending legal review.",
};

const TODO = "text-ink font-medium";

export default function SeasonRulesPage() {
  if (!isSeasonPrizeEnabled()) notFound();
  const season = seasonWindowFor();

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
        <strong>Draft, pending legal review.</strong> These rules are not final and may change. Items marked{" "}
        <span className={TODO}>[TO CONFIRM]</span> still need to be decided or checked with counsel.
      </div>

      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-8 text-small leading-relaxed text-muted md:text-body">
          <section>
            <h2 className="text-body font-semibold text-ink">1. Organizer</h2>
            <p className="mt-3">
              The season prize is organized by Competitive Together, operated by CT Pickup LLC (the &ldquo;Organizer&rdquo;).
              Organizer contact and mailing address: <span className={TODO}>[TO CONFIRM]</span>.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">2. No purchase necessary</h2>
            <p className="mt-3">
              No purchase or payment of any kind is necessary to enter or to win. Buying a game spot, a subscription or any other
              product does not improve your chances and is not required. <span className={TODO}>[TO CONFIRM]</span> alternate
              method of entry, if counsel requires one.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">3. Eligibility</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>You must be 18 years of age or older.</li>
              <li>You must be a resident of the United States. <span className={TODO}>[TO CONFIRM]</span> whether this is limited to certain states.</li>
              <li>Void where prohibited by law.</li>
              <li>You must have a Competitive Together account in good standing.</li>
              <li>
                Only players who enter the season in the app and accept the fair-play pledge are eligible. Playing games does not
                enter you automatically.
              </li>
              <li>Employees and organizers of Competitive Together: <span className={TODO}>[TO CONFIRM]</span>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">4. The season</h2>
            <p className="mt-3">
              The current season is {season.label}, from {season.startText} through {season.endText} (Eastern Time). A season runs
              for three calendar months: Spring (March to May), Summer (June to August), Fall (September to November) and Winter
              (December to February). Only games played during the season count.
            </p>
            <p className="mt-3">
              Prize for the season: ${SEASON_PRIZE_USD} to the first-place player. Currency, taxes and any additional prizes:{" "}
              <span className={TODO}>[TO CONFIRM]</span>.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">5. How points are calculated</h2>
            <p className="mt-3">Points are earned only from games with a posted result in which you played on a team:</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>{POINTS.played} points for playing in a game</li>
              <li>{POINTS.win} points for a win</li>
              <li>{POINTS.draw} points for a draw</li>
              <li>{POINTS.potd} points for Player of the Day</li>
            </ul>
            <p className="mt-3">
              Rank is by season points. Tie-breaker: <span className={TODO}>[TO CONFIRM]</span>. The leaderboard in the app is the
              reference for standings during the season; the Organizer&rsquo;s final tally at the end of the season decides.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">6. Minimum games</h2>
            <p className="mt-3">
              To be eligible to win, you must play at least {SEASON_PRIZE_MIN_GAMES} games with posted results during the season.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">7. Fair play and disqualification</h2>
            <p className="mt-3">
              By entering you accept the fair-play pledge: you will not fake games, results or votes, or work with others to
              inflate points. Cheating, fake results, vote trading or collusion lead to disqualification, and may lead to account
              removal. Decisions about disqualification are at the Organizer&rsquo;s discretion{" "}
              <span className={TODO}>[TO CONFIRM wording with counsel]</span>.
            </p>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">8. How the winner is determined and paid</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>After the season ends, the Organizer reviews the final standings and checks the leading players&rsquo; games for the rules above.</li>
              <li>The winner is the eligible, non-disqualified entrant with the most season points.</li>
              <li>The winner is notified through the app and by email. Time to respond: <span className={TODO}>[TO CONFIRM]</span>. If the winner cannot be reached or is not eligible, the Organizer may award the prize to the next eligible entrant.</li>
              <li>Payment method and timing: <span className={TODO}>[TO CONFIRM]</span>. The winner may be asked for tax information: <span className={TODO}>[TO CONFIRM]</span>.</li>
              <li>The winner&rsquo;s name may be announced: <span className={TODO}>[TO CONFIRM]</span>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-body font-semibold text-ink">9. Other terms</h2>
            <p className="mt-3">
              The Organizer may change, suspend or cancel the season prize if it cannot be run as intended. Governing law, limits of
              liability and dispute resolution: <span className={TODO}>[TO CONFIRM]</span>. These rules are in addition to the
              Terms of Service and the Liability Waiver.
            </p>
          </section>
        </div>
      </Panel>
    </PageShell>
  );
}
