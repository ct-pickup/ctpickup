import Link from "next/link";

const SIDE_IMAGE = "/community/community-side.jpg";

export default function CommunityPage() {
  return (
    <main className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%)]" />

      <div className="mx-auto max-w-6xl px-6 pt-6 relative z-10">
        <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between gap-4">
          <div className="text-base md:text-lg font-semibold tracking-wide whitespace-nowrap">
            CT Pickup
          </div>

          <div className="hidden md:flex items-center gap-6">
            <Link href="/after-login" className="text-sm font-medium">
              Home
            </Link>
            <Link href="/pickup" className="text-sm font-medium">
              Pickup Games
            </Link>
            <Link href="/tournament" className="text-sm font-medium">
              Tournaments
            </Link>
            <Link href="/training" className="text-sm font-medium">
              Training
            </Link>
            <Link href="/u23" className="text-sm font-medium">
              U23
            </Link>
            <Link href="/community" className="text-sm font-medium">
              Community
            </Link>
          </div>

          <Link href="/after-login" className="text-sm font-medium">
            Back
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-16 relative z-10">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,620px)_280px]">
          <div className="rounded-[36px] border border-white/8 bg-white/[0.035] px-8 py-10 md:px-12 md:py-14 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-[2px]">
            <div className="max-w-[620px]">
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/35">
                CT Pickup
              </div>

              <div className="mt-5 text-4xl md:text-6xl font-semibold uppercase tracking-tight">
                Community
              </div>

              <div className="mt-10 border-l border-white/12 pl-6 md:pl-8 space-y-8 text-white/80 leading-relaxed text-base md:text-lg max-w-[540px]">
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
          </div>

          <div className="hidden lg:block">
            <div className="overflow-hidden rounded-[32px] border border-white/8 bg-white/[0.03]">
              <img
                src={SIDE_IMAGE}
                alt="CT Pickup"
                className="h-[520px] w-full object-cover grayscale opacity-45"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
