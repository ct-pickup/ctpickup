"use client";

import Link from "next/link";
import PageTop from "@/components/PageTop";
import { HistoryBack } from "@/components/layout";
import { PICKUP_REFUND_UI_NOTICE } from "@/lib/fees/refundPolicyCopy";
import { APP_HOME_URL } from "@/lib/siteNav";

const upcomingCards = [
  {
    title: "Run Status",
    body: "Every game shows a live status so players know exactly where it stands.",
    bullets: [
      "Planning means the run is still being built and invited players are choosing from available time slots.",
      "Likely On means one time slot has reached enough top-tier commitment on the same slot for the run to move forward, but the final time has not yet been locked.",
      "Confirmed / Active means the exact slot has been finalized and eligible players can move into the final RSVP stage.",
      "Completed means the run has already taken place and is no longer open for responses or joining.",
    ],
  },
  {
    title: "Run Type",
    body: "Players may see the current run clearly presented without needing extra explanation about internal setup differences.",
    bullets: [
      "Runs are displayed in a simple, structured way based on what is currently open and relevant.",
      "If multiple runs are open at the same time, each appears as its own run card or section.",
    ],
  },
  {
    title: "Date and Time",
    body: "If a run is finalized, players see the confirmed date and start time.",
    bullets: [
      "If it is still in planning, time options may appear as part of the availability poll instead of one locked kickoff time.",
      "Likely On does not lock the time by itself. Admin still finalizes the exact slot afterward.",
    ],
  },
  {
    title: "Updates",
    body: "Runs may include updates with scheduling notes, changes, reminders, or other important information.",
    bullets: [
      "Players may also see broader CT Pickup updates when relevant.",
      "If more than one run is live, each run can carry its own updates separately.",
    ],
  },
  {
    title: "Invite Status",
    body: "When logged in, players may see where they stand for the current run.",
    bullets: [
      "Invited now",
      "Not yet invited",
      "Waiting for invites to open",
      "Eligible to respond",
      "Pending account approval",
    ],
  },
  {
    title: "Attendance / Who’s In",
    body: "Depending on the stage of the run and the player’s access level, confirmed attendance may be visible.",
    bullets: [
      "This gives players a sense of who is in while protecting the earlier phases of the process.",
    ],
  },
  {
    title: "Location",
    body: "The exact location is not visible to everyone.",
    bullets: [
      "Only confirmed players receive the exact location.",
      "Waitlisted players do not.",
    ],
  },
];


const joinCards = [
  {
    step: "01",
    eyebrow: "During Planning",
    title: "Players are responding to availability",
    body: "At the planning stage, players are not joining the final run yet. They are committing to a possible time.",
    bullets: [
      "If invited, a player can select one slot they are available for.",
      "Or decline.",
      "Only players who select the exact slot that is later finalized will be eligible for final RSVP.",
    ],
  },
  {
    step: "02",
    eyebrow: "During Likely On",
    title: "The run is close, but not fully locked",
    body: "When a run is marked Likely On, one slot has received enough top-tier commitment on the same exact slot to move forward.",
    bullets: [
      "Likely On does not mean the final kickoff time is locked yet.",
      "Players remain in the planning phase until admin finalizes the exact time.",
    ],
  },
  {
    step: "03",
    eyebrow: "During Confirmed / Active",
    title: "Eligible players can officially join",
    body: "Once the run is finalized, players who selected the exact finalized slot during planning may be able to confirm.",
    bullets: [
      "Confirm Spot for a free run.",
      "Pay & Confirm for a paid run.",
      "For paid runs, a spot is only fully confirmed after successful checkout and payment completion.",
      `${PICKUP_REFUND_UI_NOTICE}`,
      "Decline / Not Now if they cannot make it.",
    ],
  },
  {
    step: "04",
    eyebrow: "If the Run Is Full",
    title: "Waitlist keeps the final group controlled",
    body: "If capacity has already been reached, players who try to join will be placed on the waitlist.",
    bullets: [
      "The player is not fully confirmed.",
      "The player does not receive the exact location.",
      "Admin would need to move them in if a spot opens up.",
    ],
  },
  {
    step: "05",
    eyebrow: "If Payment Is Required",
    title: "Checkout completes confirmation",
    body: "For paid runs, joining sends the player to checkout.",
    bullets: [
      "A player may appear as pending payment until payment is successfully completed.",
      "Confirmation is not finalized until payment goes through.",
      `${PICKUP_REFUND_UI_NOTICE}`,
    ],
  },
];


const accessRules = [
  "Account approval",
  "Tier placement",
  "Whether that tier has been opened",
  "Whether the player was invited for that run",
  "Whether the player selected the finalized time during planning",
  "Whether space is still available",
  "Whether payment is required and successfully completed",
];


const pageItems = [
  "Current run status",
  "Run title",
  "Confirmed date and time or planning options",
  "Run updates",
  "Invite status",
  "Availability poll",
  "RSVP options",
  "Attendance visibility, if available",
  "Confirmation, waitlist, or pending payment status",
  "Exact location, if confirmed",
  "Multiple live runs shown as separate run sections, if applicable",
];


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-caption font-semibold text-muted">
      {children}
    </div>
  );
}

function GlassCard({
  title,
  body,
  bullets,
}: {
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="group rounded-[24px] border border-line bg-card p-6 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-line hover:bg-overlay-subtle">
      <h3 className="text-h3 font-serif font-semibold text-ink">{title}</h3>
      <p className="mt-3 text-small leading-6 text-muted">{body}</p>

      <div className="mt-5 space-y-3">
        {bullets.map((item) => (
          <div key={item} className="flex gap-3">
            <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-overlay" />
            <p className="text-small leading-6 text-muted">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageCard({
  eyebrow,
  title,
  body,
  bullets,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="rounded-pill border border-line bg-[linear-gradient(180deg,var(--overlay),var(--overlay-subtle))] p-6 backdrop-blur-xl">
      <div className="text-caption font-semibold text-muted">
        {eyebrow}
      </div>
      <h3 className="mt-3 text-h3 font-serif font-semibold text-ink">{title}</h3>
      <p className="mt-3 text-small leading-6 text-muted">{body}</p>

      <div className="mt-5 space-y-3">
        {bullets.map((item) => (
          <div key={item} className="flex gap-3">
            <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-muted" />
            <p className="text-small leading-6 text-ink">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PickupHowItWorksPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12%] top-[-10%] h-[28rem] w-[28rem] rounded-pill bg-overlay blur-3xl" />
        <div className="absolute right-[-10%] top-[18%] h-[24rem] w-[24rem] rounded-pill bg-overlay blur-3xl" />
        <div className="absolute bottom-[-12%] left-[18%] h-[26rem] w-[26rem] rounded-pill bg-overlay blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--overlay),transparent_30%)]" />
      </div>

      <div className="relative z-10">
        <div className="mx-auto max-w-6xl px-6 pt-2">
          <PageTop flush title="PICKUP" hideMenu fallbackHref="/pickup" />
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-16 pt-8">
          <section className="relative overflow-hidden rounded-pill border border-line bg-overlay-subtle p-8 backdrop-blur-2xl sm:p-10">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--pitch-panel),transparent_32%,transparent_68%,var(--overlay))]" />

            <div className="relative">
              <SectionLabel>Pickup / How It Works</SectionLabel>

              <div className="mt-4 grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
                <div>
                  <h1 className="max-w-3xl text-display font-serif font-semibold text-ink sm:text-display">
                    Upcoming Games & Joining a Game
                  </h1>

                  <p className="mt-5 max-w-2xl text-body leading-7 text-muted">
                    The Upcoming Games section gives players a clear view of what is happening now,
                    what is being built, and where they stand in the process. It is designed to keep
                    everything simple, structured, and easy to follow.
                  </p>

                  <p className="mt-4 max-w-2xl text-body leading-7 text-muted">
                    Each run may display key information based on its current stage, including status,
                    run type, timing, updates, invite access, attendance visibility, and joining options.
                  </p>

                  <div className="mt-7 flex flex-wrap gap-3">
                    <div className="rounded-pill border border-line bg-overlay-subtle px-4 py-2 text-small font-medium text-muted">
                      Live run status
                    </div>
                    <div className="rounded-pill border border-line bg-overlay-subtle px-4 py-2 text-small font-medium text-ink">
                      Invite-based access
                    </div>
                    <div className="rounded-pill border border-line bg-overlay-subtle px-4 py-2 text-small font-medium text-ink">
                      Clear join flow
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[24px] border border-line bg-overlay-strong p-5">
                    <div className="text-caption text-muted">
                      Stages
                    </div>
                    <div className="mt-4 space-y-3">
                      {["Planning", "Likely On", "Confirmed / Active"].map((item) => (
                        <div
                          key={item}
                          className="rounded-card border border-line bg-card px-4 py-3 text-small font-medium text-ink"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-line bg-overlay-strong p-5">
                    <div className="text-caption text-muted">
                      Access logic
                    </div>
                    <p className="mt-3 text-small leading-6 text-muted">
                      Runs open in a structured way based on approval, tier, invitation, selected slot,
                      and available capacity.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-14">
            <div className="mb-6">
              <SectionLabel>Upcoming Games</SectionLabel>
              <h2 className="mt-3 text-h2 font-serif font-semibold text-ink">
                What players can see
              </h2>
              <p className="mt-3 max-w-3xl text-small leading-7 text-muted">
                This section gives players a clear picture of the current run without overloading them.
                The page reveals the right information at the right time depending on the stage.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {upcomingCards.map((card) => (
                <GlassCard
                  key={card.title}
                  title={card.title}
                  body={card.body}
                  bullets={card.bullets}
                />
              ))}
            </div>
          </section>

          <section className="mt-16">
            <div className="mb-6">
              <SectionLabel>Join a Game</SectionLabel>
              <h2 className="mt-3 text-h2 font-serif font-semibold text-ink">
                How players move through the process
              </h2>
              <p className="mt-3 max-w-3xl text-small leading-7 text-muted">
                Joining depends on the stage of the run. Planning is about commitment to a time slot.
                Confirmed / Active is where eligible players officially lock in.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {joinCards.map((card) => (
                <StageCard
                  key={card.title}
                  eyebrow={card.eyebrow}
                  title={card.title}
                  body={card.body}
                  bullets={card.bullets}
                />
              ))}
            </div>
          </section>

          <section className="mt-16 grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-[28px] border border-line bg-card p-7">
              <SectionLabel>Important to Know</SectionLabel>
              <h2 className="mt-3 text-h2 font-serif font-semibold text-ink">
                Joining is structured, not fully open
              </h2>
              <p className="mt-4 text-small leading-7 text-muted">
                Joining a game is not open to everyone all at once. Access depends on several things:
              </p>

              <div className="mt-5 grid gap-3">
                {accessRules.map((item) => (
                  <div
                    key={item}
                    className="rounded-card border border-line bg-overlay-strong px-4 py-3 text-small text-ink"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-line bg-card p-7 backdrop-blur-xl">
              <SectionLabel>What You’ll See</SectionLabel>
              <h2 className="mt-3 text-h2 font-serif font-semibold text-ink">
                The Pickup page shows exactly what matters
              </h2>
              <p className="mt-4 text-small leading-7 text-muted">
                When players open the Pickup page, they may see the items below depending on their
                stage, access level, and current run status.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {pageItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-card border border-line bg-overlay-strong px-4 py-3 text-small text-ink"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-16 rounded-pill border border-line bg-[linear-gradient(180deg,var(--pitch-panel),var(--overlay-subtle))] p-8">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <SectionLabel>Final Note</SectionLabel>
                <h2 className="mt-3 text-h2 font-serif font-semibold text-ink">
                  The system is built to show players what they need — nothing more, nothing less.
                </h2>
                <p className="mt-4 max-w-3xl text-small leading-7 text-muted">
                  The page is designed to reduce confusion, protect earlier stages of the process,
                  and make the path from planning to confirmation feel clean, fair, and easy to follow.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 lg:justify-end">
                <HistoryBack
                  fallbackHref="/pickup"
                  label="Back to Pickup"
                  className="inline-flex cursor-pointer items-center justify-center rounded-pill border-0 bg-pitch px-5 py-3 text-small font-semibold text-on-pitch transition hover:opacity-90"
                />

                <Link
                  href={APP_HOME_URL}
                  className="inline-flex items-center justify-center rounded-pill border border-line bg-overlay-subtle px-5 py-3 text-small font-semibold text-ink transition hover:bg-overlay"
                >
                  Home
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}