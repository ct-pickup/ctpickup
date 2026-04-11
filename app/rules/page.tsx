import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
const SIDE_VIDEO = "/rules/side.mp4";

export default function RulesPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="grid items-start gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,620px)_280px] lg:gap-10">
        <Panel className="p-6 md:p-8 lg:p-10">
          <div className="max-w-[620px]">
            <SectionEyebrow>CT Pickup</SectionEyebrow>

            <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
              CT Pickup Rules
            </h1>

            <div className="mt-8 max-w-[540px] space-y-8 border-l border-white/15 pl-5 text-base leading-relaxed text-white/80 md:pl-8 md:text-lg">
              <p>
                CT Pickup is built on intensity, respect, and quality play. Every player who joins is expected to understand the standard and protect the environment. These rules are not optional. They exist to keep the level high, the games competitive, and the experience right for everyone on the field.
              </p>

              <p className="text-sm text-white/65 md:text-base">
                <span className="font-semibold text-white/85">Esports (online tournaments):</span>{" "}
                Registration fees, refunds, and tournament conduct are governed by the separate{" "}
                <Link
                  href="/legal/esports/official-rules#refund-policy"
                  className="text-[var(--brand)] underline-offset-4 hover:underline"
                >
                  Official Tournament Rules
                </Link>{" "}
                (not this on-field rules page).
              </p>

              <div className="space-y-8">
                <div>
                  <p className="font-semibold text-white">1. Respect Comes First</p>
                  <p className="mt-2">
                    Respect for the game, the field, staff, and every player is the foundation of CT Pickup. Competitive energy is encouraged, but disrespect is not. Fights, threats, hostile behavior, and actions that damage the atmosphere are not tolerated. Anyone deemed disrespectful, disruptive, or harmful to the environment may be suspended indefinitely or dropped a tier.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">2. Community Over Competition</p>
                  <p className="mt-2">
                    We compete hard, but the community comes first. CT Pickup is about building the right environment for everyone involved. Every player is responsible for keeping good vibes on the field and contributing to a competitive but respectful atmosphere.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">3. High Intensity Is Required</p>
                  <p className="mt-2">
                    This is not a casual or low-intensity environment. Every player is expected to bring effort, urgency, and energy. Players who consistently fail to meet the intensity standard may be moved down a tier. We play with three teams, so rest is always built in. When you are on, compete.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">4. No Slide Tackles</p>
                  <p className="mt-2">
                    Slide tackles are strictly prohibited under all circumstances. There are no exceptions, including tournament play. Any player who slides will be removed and not invited back. Excessive fouls or actions deemed purposeful to hurt another player will result in an immediate ban.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">5. No Referees, No Official Jerseys</p>
                  <p className="mt-2">
                    Pickup means players are responsible for managing the game properly. There are no referees and no official jerseys. Players are expected to handle disputes maturely, keep play moving, and act in the best interest of the run.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">6. Be On Time and Ready</p>
                  <p className="mt-2">
                    Players should arrive early, checked in, and ready to play before the session begins. Late arrivals disrupt team organization and game flow. Your spot may be given away if you do not arrive on time and you be dropped down a tier.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">7. No Spot Holding</p>
                  <p className="mt-2">
                    Only registered and confirmed players are guaranteed a place. Do not hold spots for friends or bring extra players without approval. This keeps sessions fair and organized for everyone who signed up properly. Failure to follow this rule may result in an indefinite suspension. Any player allowed back after violating this rule may be required to watch or pay a $75 fee to play.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">8. No Offsides</p>
                  <p className="mt-2">
                    There are no offsides unless a specific update says otherwise. This keeps the game flowing and allows players to attack and defend freely.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">9. Ball Out of Bounds</p>
                  <p className="mt-2">
                    Out of bounds follows normal rules unless the playing environment changes it. If we are indoors and walls are in play, the wall may be used as a rebounder. If the ball hits the ceiling or netting above, possession is lost and the team that kicked it up must give the ball to the opposing team.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">10. Kick-Ins, Not Throw-Ins</p>
                  <p className="mt-2">
                    When the ball goes out, play restarts with a kick-in instead of a throw-in. This keeps the tempo high and the game moving.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">11. Game Time</p>
                  <p className="mt-2">
                    Game length will be determined by the number of players and the format of the session. No game will be shorter than 5 minutes.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">12. No-Shows and Refunds (pickups)</p>
                  <p className="mt-2">
                    Refunds are available only if cancellation is completed before 10:00 PM on the day
                    before the scheduled pickup. If you cancel after that time or you no-show, your pickup
                    fee is not refunded. If the Organizer cancels the pickup, a refund may still be
                    issued. Verified duplicate or erroneous charges will be corrected. Spots are limited,
                    and last-minute no-shows prevent other players from joining. No-shows may also affect
                    future eligibility. For tournament fees (in-person captain registration and online
                    esports), see checkout and the{" "}
                    <Link
                      href="/legal/esports/official-rules#refund-policy"
                      className="text-[var(--brand)] underline-offset-4 hover:underline"
                    >
                      Official Tournament Rules
                    </Link>{" "}
                    where applicable.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">13. Follow Staff Decisions</p>
                  <p className="mt-2">
                    CT Pickup staff reserve the right to organize teams, adjust formats, manage rotations, and make decisions that protect the quality of the session. These decisions are made in the best interest of the full group and must be respected.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">14. Protect the Standard</p>
                  <p className="mt-2">
                    CT Pickup is more than just open play. It is a curated soccer experience built around competition, dependability, and community. Players who consistently disrupt that standard may be removed from a session or restricted from future participation.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">15. Come to Compete, Come to Contribute</p>
                  <p className="mt-2">
                    Every player helps shape the atmosphere. Bring energy, effort, and the right attitude. CT Pickup is at its best when players show up ready to compete, connect, and elevate the level for everyone.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">16. Eligibility, Age, and Participation</p>
                  <p className="mt-2">
                    Females are welcome to play. For training, players ages 8 and older are welcome to participate. For physical pickup games and match play, players must be at least 16 years old to participate.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-white">17. Eligibility and Accountability</p>
                  <p className="mt-2">
                    By joining CT Pickup, you are agreeing to the rules and standards of the platform. Failure to meet eligibility requirements, failure to follow the rules, or complaining about rules after agreeing to them may result in a 30-day suspension or permanent removal.
                  </p>
                </div>
              </div>

              <div>
                <p className="font-semibold text-white">Our Standard</p>
                <p className="mt-2">
                  CT Pickup is designed for players who value quality soccer, strong competition, and a professional environment. These rules are not here to limit the game. They are here to protect what makes it great. When everyone respects the standard, every session becomes better, sharper, and more worth showing up for.
                </p>
              </div>

              <p className="font-semibold text-white">
                Compete hard. Respect everyone. Protect the level.
              </p>
            </div>
          </div>
        </Panel>

        <div className="hidden lg:block">
          <Panel className="overflow-hidden p-0">
            <video
              src={SIDE_VIDEO}
              autoPlay
              muted
              loop
              playsInline
              className="h-[520px] w-full object-cover grayscale opacity-50"
            />
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
