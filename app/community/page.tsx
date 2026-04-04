import {
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
const SIDE_IMAGE = "/community/community-side.jpg";

export default function CommunityPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav brandHref="/after-login" backHref="/after-login" />

      <div className="grid items-start gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,620px)_280px] lg:gap-10">
        <Panel className="p-6 md:p-8 lg:p-10">
          <div className="max-w-[620px]">
            <SectionEyebrow>CT Pickup</SectionEyebrow>

            <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
              Community
            </h1>

            <div className="mt-8 space-y-8 border-l border-white/15 pl-5 text-base leading-relaxed text-white/80 md:pl-8 md:text-lg">
              <p>
                CT Pickup is an organized pickup soccer community built for players
                who want quality games without the commitment of a traditional league.
                We created CT Pickup to make playing soccer easier, more consistent,
                and more accessible for players across Connecticut who are looking
                for real competition, flexible scheduling, and a better overall
                experience.
              </p>

              <p>
                We know how hard it can be to find a good run. Too often, pickup
                games are unorganized, unreliable, or missing the level of structure
                players want. CT Pickup changes that by offering a dependable space
                where players can show up, compete, and enjoy the game in an
                environment that is built around community, energy, and quality play.
              </p>

              <p>
                At CT Pickup, soccer is more than a game. It is community,
                consistency, and culture. We are building a home for players who want
                to play more, compete harder, and be part of something bigger every
                time they step on the field.
              </p>
            </div>
          </div>
        </Panel>

        <div className="hidden lg:block">
          <Panel className="overflow-hidden p-0">
            <img
              src={SIDE_IMAGE}
              alt="CT Pickup"
              className="h-[520px] w-full object-cover grayscale opacity-50"
            />
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
