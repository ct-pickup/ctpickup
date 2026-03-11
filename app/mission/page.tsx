import Link from "next/link";

const SIDE_IMAGE = "/mission/side.jpg";

export default function MissionPage() {
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
            <Link href="/mission" className="text-sm font-medium">
              Mission
            </Link>
          </div>

          <Link href="/after-login" className="text-sm font-medium">
            Back
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-16 relative z-10">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,620px)_280px]">
          <div className="rounded-[36px] border border-white/8 bg-white/[0.035] px-8 py-10 md:px-12 md:py-14 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-[2px]">
            <div className="max-w-[620px]">
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/35">
                CT Pickup
              </div>

              <div className="mt-5 text-4xl md:text-6xl font-semibold uppercase tracking-tight">
                Our Mission
              </div>

              <div className="mt-10 border-l border-white/12 pl-6 md:pl-8 space-y-8 text-white/80 leading-relaxed text-base md:text-lg max-w-[540px]">
                <p>
                  CT Pickup exists to make high-level soccer easier to access without
                  lowering the standard.
                </p>

                <p>
                  What began as a few competitive games has grown into a network where
                  dedicated players connect, develop their skills, and support one
                  another.
                </p>

                <p>
                  We keep sessions open when possible and curate them as needed to
                  maintain quality. Our continued growth depends on your involvement.
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