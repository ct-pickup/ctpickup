import Link from "next/link";
import AutoSlider from "@/components/AutoSlider";

const APPLY_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";
const AFTER_LOGIN_URL = "/after-login?new=1";

export default function U23Page() {
  const images = [{ src: "/u23-team.jpg", alt: "U23 Select Team" }];

  const playerBenefits = [
    {
      title: "Matches",
      body: "Curated games against strong opponents, including college, U23, and semi-pro teams when available.",
    },
    {
      title: "Training",
      body: "Organized sessions built around pace, structure, and accountability.",
    },
    {
      title: "Exposure",
      body: "Increased visibility through the CT Pickup network, including runs, staff, coaches, and affiliated teams.",
    },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,#070707_0%,#0a0a0a_45%,#050505_100%)] text-white">
      <div className="mx-auto max-w-7xl px-5 pb-20 pt-6 md:px-6 md:pt-8">
        <header className="rounded-full border border-black/10 bg-white px-6 py-4 text-black shadow-[0_10px_40px_rgba(0,0,0,0.18)] md:px-7">
          <div className="flex items-center justify-between gap-6">
            <div className="text-[22px] font-medium tracking-tight text-black/90">
              CT Pickup
            </div>

            <nav className="hidden items-center gap-8 text-[15px] text-black/75 md:flex">
              <Link href={AFTER_LOGIN_URL} className="transition hover:text-black">
                Home
              </Link>
              <Link href="/pickup-games" className="transition hover:text-black">
                Pickup Games
              </Link>
              <Link href="/tournaments" className="transition hover:text-black">
                Tournaments
              </Link>
              <Link href="/training" className="transition hover:text-black">
                Training
              </Link>
              <span className="font-medium text-black">U23</span>
              <Link href="/about" className="transition hover:text-black">
                About
              </Link>
            </nav>

            <div className="hidden md:flex">
              <Link
                href={AFTER_LOGIN_URL}
                className="inline-flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-[15px] text-black/80 transition hover:text-black"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 19.5a6.75 6.75 0 10-7.5 0m7.5 0a9 9 0 10-7.5 0m7.5 0a8.968 8.968 0 01-7.5 0"
                    />
                  </svg>
                </span>
                Jackson
              </Link>
            </div>

            <div className="md:hidden">
              <Link
                href={AFTER_LOGIN_URL}
                className="text-sm font-medium text-black/80 transition hover:text-black"
              >
                Home
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm md:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">
              CT Pickup
            </p>

            <div className="mt-5 space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold uppercase tracking-tight text-white md:text-6xl">
                U23 Select Team
              </h1>

              <p className="max-w-2xl text-base leading-7 text-white/78 md:text-lg">
                A competitive U23 team formed through the CT Pickup network, built for
                high-level matches, structured training, and clear standards.
              </p>

              <div className="h-px w-full max-w-xl bg-white/10" />

              <div className="space-y-4 text-base leading-7 text-white/80">
                <p>
                  We look for clean technical play under pressure, reliable communication,
                  and players who care about doing things the right way.
                </p>
                <p>
                  Humility, accountability, and commitment are required. This is not an
                  open roster. It is a selected environment.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <a
                  href={APPLY_FORM}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-full border border-white bg-white px-5 py-3 text-sm font-semibold text-black transition hover:scale-[1.01]"
                >
                  Apply Now
                </a>

                <Link
                  href={AFTER_LOGIN_URL}
                  className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                >
                  Back
                </Link>
              </div>

              <div className="pt-3">
                <p className="text-sm text-white/62">
                  If selected, we will contact you directly.
                </p>
                <p className="mt-2 text-sm text-white/45">
                  Not all applicants will be accepted. We are building the right team,
                  not the biggest one.
                </p>
              </div>
            </div>
          </div>

          <div className="self-start rounded-[32px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.42)] backdrop-blur-sm md:p-5">
            <div className="overflow-hidden rounded-[24px] border border-white/10">
              <div className="min-h-[320px] md:min-h-[420px]">
                <AutoSlider images={images} intervalMs={5000} />
              </div>
            </div>

            <div className="space-y-1 px-1 pt-3">
              <p className="text-sm font-medium tracking-tight text-white/88 md:text-base">
                U23 Select Team, 2025
              </p>
              <p className="text-xs text-white/50 md:text-sm">Built through CT Pickup.</p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-7 backdrop-blur-sm md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
              Standards
            </p>
            <h2 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white">
              High level, serious environment
            </h2>
            <p className="mt-4 text-base leading-7 text-white/76">
              We value composure, intensity, and consistency. Players are expected to
              compete, communicate, and carry themselves with maturity every time they
              step on the field.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-7 backdrop-blur-sm md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
              What Players Get
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {playerBenefits.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[22px] border border-white/10 bg-black/30 p-5"
                >
                  <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/72">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.03] p-7 backdrop-blur-sm md:p-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
              Video Highlights
            </p>
            <h2 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
              2025 Summer Season
            </h2>
            <p className="mt-4 text-base leading-7 text-white/72">
              Match footage from the U23 team. The presentation stays clean and cinematic,
              while the video itself remains bright and easy to watch.
            </p>
          </div>

          <div className="mt-8 grid gap-6">
            <div className="rounded-[24px] border border-white/10 bg-black/35 p-3">
              <video
                className="w-full rounded-[18px] border border-white/10 bg-black"
                controls
                preload="metadata"
              >
                <source src="/u23-clip-1.mp4" type="video/mp4" />
              </video>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/35 p-3">
              <video
                className="w-full rounded-[18px] border border-white/10 bg-black"
                controls
                preload="metadata"
              >
                <source src="/u23-clip-2.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}