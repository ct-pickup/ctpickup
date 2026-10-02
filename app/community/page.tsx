import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
const SIDE_IMAGE = "/community/community-side.jpg";

export default function CommunityPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="grid items-start gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,620px)_minmax(300px,1fr)] lg:gap-10">
        <Panel className="p-6 md:p-8 lg:p-10">
          <div className="max-w-[620px]">
            <SectionEyebrow>Competitive Together</SectionEyebrow>

            <h1 className="mt-4 text-h1 font-serif font-semibold text-ink md:text-display">
              Community
            </h1>

            <div className="mt-8 space-y-8 border-l border-line pl-5 text-body leading-relaxed text-ink md:pl-8 md:text-h3 font-serif">
              <p>
                Competitive Together is an organized pickup soccer community built for players
                who want quality games without the commitment of a traditional league.
                We created Competitive Together to make playing soccer easier, more consistent,
                and more accessible for players who are looking
                for real competition, flexible scheduling, and a better overall
                experience.
              </p>

              <p>
                We know how hard it can be to find a good run. Too often, pickup
                games are unorganized, unreliable, or missing the level of structure
                players want. Competitive Together changes that by offering a dependable space
                where players can show up, compete, and enjoy the game in an
                environment that is built around community, energy, and quality play.
              </p>

              <p>
                At Competitive Together, soccer is more than a game. It is community,
                consistency, and culture. We are building a home for players who want
                to play more, compete harder, and be part of something bigger every
                time they step on the field.
              </p>
            </div>
          </div>
        </Panel>

        <div className="hidden min-w-0 lg:block">
          <Panel className="overflow-hidden p-0">
            <div className="relative aspect-[3/2] w-full overflow-hidden">
              <img
                src={SIDE_IMAGE}
                alt="Competitive Together"
                className="absolute bottom-0 left-0 h-[136%] w-full object-cover object-bottom grayscale opacity-50"
              />
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
