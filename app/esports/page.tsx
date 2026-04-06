import Link from "next/link";
import type { Metadata } from "next";
import { EsportsMark } from "@/components/esports/EsportsMark";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { APP_HOME_URL } from "@/lib/siteNav";

export const metadata: Metadata = {
  title: "Esports | CT Pickup",
  description:
    "EA SPORTS FC esports: tournament brackets, a cash prize for the winner, $10 buy-in per player, and open signup.",
};

const highlights = [
  {
    title: "EA SPORTS FC",
    subtitle: "Current version",
    body: "All matches are played on the latest EA SPORTS FC release, so every game stays current, consistent, and fair.",
  },
  {
    title: "Tournament play",
    subtitle: "Structured competition",
    body: "Each event follows a clear bracket format from the opening match to the final. Simple, competitive, and built to crown one winner.",
  },
  {
    title: "Cash prize",
    subtitle: "Winner takes it",
    body: "The champion earns a real cash payout. Straightforward stakes, real incentive.",
  },
  {
    title: "Buy-in",
    subtitle: "$10 per player",
    body: "EA SPORTS FC tournaments use a $10 buy-in per player. That is the stake to enter the bracket; the winner still takes the advertised cash prize.",
  },
  {
    title: "Open to everyone",
    subtitle: "All welcome",
    body: "New players and returning competitors are all welcome. If you can follow the schedule and respect the rules, you can join the field.",
  },
] as const;

export default function EsportsPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
      <TopNav
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <EsportsSetupNudgeBar />

      <header className="mt-4 grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-center lg:gap-12">
        <div className="space-y-5">
          <SectionEyebrow>CT Pickup</SectionEyebrow>

          <h1 className="text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
            Esports
          </h1>

          <p className="max-w-xl text-sm uppercase tracking-[0.2em] text-white/55 md:text-xs md:tracking-[0.24em]">
            EA SPORTS FC · Tournaments · Cash prize
          </p>

          <p className="max-w-xl text-base leading-relaxed text-white/78 md:text-lg md:leading-8">
            Our esports series runs on the current EA SPORTS FC title, featuring
            tournament brackets, a cash prize for the winner, and{" "}
            <span className="text-white/90">a $10 buy-in per player</span> for anyone
            ready to sign up and compete.
          </p>

          <div className="pt-1">
            <Link
              href="/esports/tournaments"
              className="inline-flex items-center justify-center rounded-md bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
            >
              View Tournaments
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-white/[0.07] via-[#141415] to-black/90 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.55)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 80% 55% at 50% 28%, rgba(34,197,94,0.14), transparent 55%), radial-gradient(circle at 85% 75%, rgba(255,255,255,0.04), transparent 45%)",
            }}
          />
          <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-5 px-8 py-12 md:min-h-[300px] md:py-16">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm md:p-10">
              <EsportsMark className="mx-auto h-28 w-28 text-white md:h-36 md:w-36" />
            </div>
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">
              Competitive · Digital · CT Pickup
            </p>
          </div>
        </div>
      </header>

      <section className="mt-10 scroll-mt-24 md:mt-14">
        <Panel className="p-6 md:p-8">
          <h2 className="text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            What You&apos;re Signing Up For
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/65 md:text-base">
            Five things to know before you lock in. Short, clear, and built for
            players who want real competition without the extra noise.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((item) => (
              <li
                key={item.title}
                className="rounded-xl border border-white/12 bg-white/[0.04] p-5 transition hover:border-white/18 hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold tracking-tight text-white md:text-lg">
                    {item.title}
                  </h3>
                  <span className="shrink-0 rounded-full border border-[var(--brand)]/35 bg-[var(--brand)]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand)]">
                    {item.subtitle}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/70">{item.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section id="competition-format" className="mt-6 scroll-mt-24 md:mt-8">
        <Panel className="p-6 md:p-8">
          <h2 className="text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            Competition Format
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/60 md:text-base">
            Official structure for CT Pickup Esports on EA SPORTS FC 26—access,
            match standards, bracket flow, proof of results, and scheduling
            obligations.
          </p>

          <div className="mt-8 space-y-10 border-t border-white/10 pt-8">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                1. Access &amp; location
              </h3>
              <ul className="mt-4 space-y-3">
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>Open to everyone.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>Entry: $10 per player (EA SPORTS FC tournaments).</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Play from anywhere—home, school, or any location with a stable
                    connection.
                  </span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>No centralized venue required.</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                2. Match settings
              </h3>
              <ul className="mt-4 space-y-3">
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>6-minute halves.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>Normal game speed.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>Standard EA SPORTS FC 26 rules apply.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Default tournament settings only—no custom advantages or altered
                    match parameters.
                  </span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                3. Tournament structure
              </h3>

              <div className="mt-5 space-y-6">
                <div>
                  <p className="text-sm font-semibold text-white md:text-base">
                    Group stage
                  </p>
                  <ul className="mt-3 space-y-3">
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>Players are placed into groups.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>You must coordinate matches with your group.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>
                        All group stage games must be completed within the week.
                      </span>
                    </li>
                  </ul>
                  <p className="mt-4 text-sm font-medium text-white/85">
                    Standings are based on:
                  </p>
                  <ul className="mt-2 space-y-2 pl-1">
                    <li className="flex gap-3 text-sm leading-relaxed text-white/72 md:text-base">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/35" />
                      <span>Points</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/72 md:text-base">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/35" />
                      <span>Goal differential</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/72 md:text-base">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/35" />
                      <span>Goals scored (if needed)</span>
                    </li>
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-semibold text-white md:text-base">
                    Knockout stage{" "}
                    <span className="font-normal text-white/55">
                      (Monday–Wednesday, deadline 11:59 PM ET)
                    </span>
                  </p>
                  <ul className="mt-3 space-y-3">
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>Top players advance to knockout.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>Single elimination format.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>One loss = elimination.</span>
                    </li>
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-semibold text-white md:text-base">
                    Playoff stage{" "}
                    <span className="font-normal text-white/55">
                      (Thursday–Saturday, deadline 11:59 PM ET)
                    </span>
                  </p>
                  <ul className="mt-3 space-y-3">
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>Remaining players compete in playoff rounds.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>Each matchup is a best-of-3 series.</span>
                    </li>
                    <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span>You must play all games in the series.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                4. Match reporting
              </h3>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                Required — proof after every match
              </p>
              <ul className="mt-4 space-y-3">
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>After each match, players must submit proof.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Acceptable proof includes a screen recording or the match result
                    screen.
                  </span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    For best-of-3 series, proof must be submitted for every game in
                    the series.
                  </span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Failure to submit proof may result in match disqualification.
                  </span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                5. Scheduling
              </h3>
              <ul className="mt-4 space-y-3">
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>Players are responsible for coordinating matches.</span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Matches must be completed within the assigned time windows.
                  </span>
                </li>
                <li className="flex gap-3 text-sm leading-relaxed text-white/78 md:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    Failure to complete matches may result in forfeits.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </Panel>
      </section>
    </PageShell>
  );
}
