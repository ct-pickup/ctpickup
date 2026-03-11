import Link from "next/link";

type Coach = {
  name: string;
  experience: string;
  homeField: string;
  specialty: string;
};

const coaches: Coach[] = [
  {
    name: "COACH 1 NAME",
    experience: "College / Position / Highest level played",
    homeField: "Home field: Town, State",
    specialty: "Specialty: Technical work, speed of play, finishing",
  },
  {
    name: "COACH 2 NAME",
    experience: "College / Position / Highest level played",
    homeField: "Home field: Town, State",
    specialty: "Specialty: 1v1s, first touch, ball mastery",
  },
  {
    name: "COACH 3 NAME",
    experience: "College / Position / Highest level played",
    homeField: "Home field: Town, State",
    specialty: "Specialty: Scanning, decision-making, movement",
  },
  {
    name: "COACH 4 NAME",
    experience: "College / Position / Highest level played",
    homeField: "Home field: Town, State",
    specialty: "Specialty: Passing, composure, midfield IQ",
  },
  {
    name: "COACH 5 NAME",
    experience: "College / Position / Highest level played",
    homeField: "Home field: Town, State",
    specialty: "Specialty: Defending, positioning, recovery speed",
  },
];

const GOOGLE_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[#bfb7aa] font-semibold">
      {children}
    </div>
  );
}

function TopNav() {
  return (
    <div className="mb-10 sm:mb-12">
      <div className="mx-auto w-full rounded-full border border-black/10 bg-[#f3f1ec] px-4 sm:px-6 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="shrink-0 text-lg sm:text-[1.7rem] font-medium tracking-[-0.02em] text-[#202020]"
          >
            CT Pickup
          </Link>

          <nav className="hidden md:flex flex-1 items-center justify-center gap-8 text-[15px] text-[#5f5a53]">
            <Link href="/" className="transition hover:text-black">
              Home
            </Link>
            <Link href="/pickup-games" className="transition hover:text-black">
              Pickup Games
            </Link>
            <Link href="/tournaments" className="transition hover:text-black">
              Tournaments
            </Link>
            <Link href="/training" className="text-black">
              Training
            </Link>
            <Link href="/u23" className="transition hover:text-black">
              U23
            </Link>
            <Link href="/community" className="transition hover:text-black">
              Community
            </Link>
          </nav>

          <Link
            href="/"
            className="shrink-0 text-[15px] text-[#5f5a53] transition hover:text-black"
          >
            Back
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TrainingPage() {
  return (
    <main className="min-h-screen bg-[#070809] text-[#f5f3ee]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(180,190,200,0.10),transparent_34%),radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.04),transparent_18%)]" />
        <div
          className="absolute inset-0 opacity-[0.045]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-[#070809]" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
          <TopNav />

          <header className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <div className="space-y-5">
              <div className="space-y-3">
                <SectionEyebrow>CT Pickup</SectionEyebrow>

                <h1 className="max-w-3xl text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] uppercase text-[#f7f4ee]">
                  Training Sessions
                </h1>

                <p className="max-w-2xl text-sm sm:text-base lg:text-lg text-[#d7d3cb] leading-relaxed">
                  Small-group and 1:1 sessions for players who want sharper touches,
                  cleaner execution, faster decisions, and real-game carryover.
                </p>
              </div>

              <p className="text-sm text-[#b7b1a6]">
                Open to anyone. We’ll follow up with next steps.
              </p>
            </div>

            <div className="relative">
              <div className="absolute -inset-3 rounded-[32px] bg-white/5 blur-2xl" />
              <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.04] shadow-[0_24px_100px_rgba(0,0,0,0.42)]">
                <div className="absolute inset-0 z-10 bg-[linear-gradient(to_top,rgba(7,8,9,0.14),rgba(255,244,230,0.03))] pointer-events-none" />
                <video
                  className="block h-[320px] sm:h-[420px] lg:h-[520px] w-full object-cover bg-black [filter:saturate(0.82)_contrast(0.95)_brightness(0.93)]"
                  src="/training-hero.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                />
              </div>
            </div>
          </header>

          <section className="mt-12 sm:mt-14 grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-6 md:p-7">
              <SectionEyebrow>Format</SectionEyebrow>
              <h2 className="mt-3 text-2xl font-semibold uppercase tracking-tight text-[#f7f4ee]">
                What Sessions Focus On
              </h2>
              <p className="mt-4 text-[#d9d4cb] leading-relaxed">
                Technical sharpness, speed of play, first touch, scanning, movement,
                finishing, and decision-making under real pressure.
              </p>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-6 md:p-7">
              <SectionEyebrow>Location + Travel</SectionEyebrow>
              <h2 className="mt-3 text-2xl font-semibold uppercase tracking-tight text-[#f7f4ee]">
                Standard Service Area
              </h2>

              <p className="mt-4 text-[#d9d4cb] leading-relaxed">
                Sessions are usually held at the coach’s home field. If you are within
                about 45 minutes, you are generally within the standard service area.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm uppercase tracking-[0.16em] text-[#bfb7aa]">
                    0–15 min
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-[#f7f4ee]">$0</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm uppercase tracking-[0.16em] text-[#bfb7aa]">
                    15–30 min
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-[#f7f4ee]">
                    +$10
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm uppercase tracking-[0.16em] text-[#bfb7aa]">
                    30–45 min
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-[#f7f4ee]">
                    +$20
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm uppercase tracking-[0.16em] text-[#bfb7aa]">
                    45+ min
                  </div>
                  <div className="mt-1 text-lg font-semibold text-[#f7f4ee]">
                    Case by Case
                  </div>
                </div>
              </div>

              <p className="mt-5 text-sm text-[#b7b1a6] leading-relaxed">
                Exact field location and any travel add-on are confirmed after booking.
              </p>
            </div>
          </section>

          <section className="mt-12 sm:mt-14 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 md:p-7 lg:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <SectionEyebrow>Coaches</SectionEyebrow>
                <h2 className="mt-3 text-2xl sm:text-3xl font-semibold uppercase tracking-tight text-[#f7f4ee]">
                  Choose the Right Fit
                </h2>
                <p className="mt-2 max-w-2xl text-sm sm:text-base text-[#bdb6ab] leading-relaxed">
                  Select a coach and we’ll help coordinate the best match for your level,
                  goals, and location.
                </p>
              </div>

              <a
                href={GOOGLE_FORM}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] px-5 text-sm font-semibold text-[#f4f0e9] transition hover:bg-white/[0.08]"
              >
                Request a Coach
              </a>
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {coaches.map((c, i) => (
                <div
                  key={c.name}
                  className="group overflow-hidden rounded-[24px] border border-white/10 bg-black/20 transition hover:bg-white/[0.045]"
                >
                  <div className="relative h-52 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.02))]">
                    <div className="absolute left-4 top-4 inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/10 bg-black/30 px-2 text-xs font-semibold text-[#cec7bc]">
                      {String(i + 1).padStart(2, "0")}
                    </div>

                    <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur-sm">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[#bfb7aa]">
                        Coach Profile
                      </div>
                      <div className="mt-1 text-lg font-semibold uppercase tracking-tight text-[#f7f4ee]">
                        {c.name}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 p-5">
                    <p className="text-sm text-[#ddd7cf] leading-relaxed">
                      {c.experience}
                    </p>
                    <p className="text-sm text-[#bdb6ab] leading-relaxed">
                      {c.homeField}
                    </p>
                    <p className="text-sm text-[#bdb6ab] leading-relaxed">
                      {c.specialty}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
