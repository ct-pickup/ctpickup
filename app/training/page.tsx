import Link from "next/link";
import { CoachHeadshot } from "@/components/training/CoachHeadshot";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { trainingCoaches, TRAINING_REQUEST_LINK } from "@/lib/trainingCoaches";

export default function TrainingPage() {
  return (
    <PageShell>
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />

      <header className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-10">
        <div className="space-y-4">
          <SectionEyebrow>CT Pickup</SectionEyebrow>

          <h1 className="text-3xl font-bold tracking-[0.45em] text-white md:text-4xl md:tracking-[0.55em]">
            TRAINING
          </h1>

          <p className="text-xs uppercase tracking-[0.22em] text-white/70 md:text-sm">
            Sessions · 1:1 and small group
          </p>

          <p className="max-w-xl text-sm leading-relaxed text-white/75 md:text-base">
            Small-group and 1:1 sessions for players who want sharper touches,
            cleaner execution, faster decisions, and real-game carryover.
          </p>

          <p className="text-sm text-white/60">
            Book through our request form and we’ll follow up with next steps.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/15 bg-black">
          <video
            className="block aspect-video w-full object-cover sm:aspect-[4/3] lg:aspect-auto lg:h-[min(100%,420px)] lg:min-h-[280px]"
            src="/training-hero.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        </div>
      </header>

      <section className="mt-10 grid gap-4 sm:mt-12 lg:grid-cols-2 lg:gap-5">
        <Panel>
          <SectionEyebrow>Format</SectionEyebrow>
          <h2 className="mt-3 text-lg font-semibold uppercase tracking-wide text-white">
            What Sessions Focus On
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/75">
            Technical sharpness, speed of play, first touch, scanning, movement,
            finishing, and decision-making under real pressure.
          </p>
        </Panel>

        <Panel>
          <SectionEyebrow>Location + Travel</SectionEyebrow>
          <h2 className="mt-3 text-lg font-semibold uppercase tracking-wide text-white">
            Standard Service Area
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-white/75">
            Sessions are usually held at the coach’s home field. If you are within
            about 45 minutes, you are generally within the standard service area.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3">
            {[
              { label: "0–15 min", value: "$0" },
              { label: "15–30 min", value: "+$10" },
              { label: "30–45 min", value: "+$20" },
              { label: "45+ min", value: "Case by case", small: true },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-xl border border-white/15 bg-white/5 p-3 sm:p-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                  {cell.label}
                </div>
                <div
                  className={
                    cell.small
                      ? "mt-1 text-base font-semibold text-white"
                      : "mt-1 text-xl font-semibold text-white sm:text-2xl"
                  }
                >
                  {cell.value}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-white/55 leading-relaxed">
            Exact field location and any travel add-on are confirmed after booking.
          </p>
        </Panel>
      </section>

      <section id="coaches" className="mt-10 scroll-mt-24 sm:mt-12 sm:scroll-mt-28">
        <Panel className="p-5 md:p-6 lg:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SectionEyebrow>Coaches</SectionEyebrow>
              <h2 className="mt-3 text-lg font-semibold uppercase tracking-wide text-white sm:text-xl">
                Choose the Right Fit
              </h2>
              <p className="mt-2 max-w-xl text-sm text-white/65 leading-relaxed">
                Click a coach for full profile, background, and booking.
              </p>
            </div>

            <a
              href={TRAINING_REQUEST_LINK}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Request Training
            </a>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {trainingCoaches.map((c, i) => (
              <Link
                key={c.slug}
                href={`/training/coaches/${c.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/5 transition hover:bg-white/[0.08]"
              >
                <div className="shrink-0 border-b border-white/10 px-4 pt-4 pb-3">
                  <div className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 px-2.5 text-xs font-semibold tabular-nums text-white/85">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                </div>

                <div className="px-4 pt-3 pb-4">
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-white/15 bg-[#141415]">
                    <CoachHeadshot
                      slug={c.slug}
                      name={c.name}
                      className="h-full w-full min-h-0"
                      imagePosition={c.imagePosition}
                      loading={i < 3 ? "eager" : "lazy"}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-14">
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-white sm:text-base">
                        {c.name}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-2 border-t border-white/10 p-4 text-sm">
                  <p className="font-semibold leading-snug text-white">{c.college}</p>
                  <p className="text-white/80">{c.position}</p>
                  <p className="text-white/65 leading-snug">
                    Hometown: {c.hometown || "Connecticut"}
                  </p>
                  <p className="text-white/65 leading-snug">
                    Specialty: {c.cardSpecialty}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      </section>
    </PageShell>
  );
}
