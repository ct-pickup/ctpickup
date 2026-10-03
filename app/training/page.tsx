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
          <SectionEyebrow>Competitive Together</SectionEyebrow>

          <h1 className="text-h1 font-serif font-bold text-ink md:text-display">
            TRAINING
          </h1>

          <p className="text-caption text-muted md:text-small">
            Sessions · 1:1 and small group
          </p>

          <p className="max-w-xl text-small leading-relaxed text-muted md:text-body">
            Small-group and 1:1 sessions for players who want sharper touches,
            cleaner execution, faster decisions, and real-game carryover.
          </p>

          <p className="text-small text-muted">
            Book through our request form and we’ll follow up with next steps.
          </p>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-canvas">
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
          <h2 className="mt-3 text-h3 font-serif font-semibold text-ink">
            What Sessions Focus On
          </h2>
          <p className="mt-3 text-small leading-relaxed text-muted">
            Technical sharpness, speed of play, first touch, scanning, movement,
            finishing, and decision-making under real pressure.
          </p>
        </Panel>

        <Panel>
          <SectionEyebrow>Location + Travel</SectionEyebrow>
          <h2 className="mt-3 text-h3 font-serif font-semibold text-ink">
            Standard Service Area
          </h2>

          <p className="mt-3 text-small leading-relaxed text-muted">
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
                className="rounded-card border border-line bg-card p-3 sm:p-4"
              >
                <div className="text-caption font-semibold text-muted">
                  {cell.label}
                </div>
                <div
                  className={
                    cell.small
                      ? "mt-1 text-body font-semibold text-ink"
                      : "mt-1 text-h3 font-serif font-semibold text-ink sm:text-h2"
                  }
                >
                  {cell.value}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-caption text-muted leading-relaxed">
            Exact field location and any travel add-on are confirmed after booking.
          </p>
        </Panel>
      </section>

      <section id="coaches" className="mt-10 scroll-mt-24 sm:mt-12 sm:scroll-mt-28">
        <Panel className="p-5 md:p-6 lg:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SectionEyebrow>Coaches</SectionEyebrow>
              <h2 className="mt-3 text-h3 font-serif font-semibold text-ink sm:text-h3">
                Choose the Right Fit
              </h2>
              <p className="mt-2 max-w-xl text-small text-muted leading-relaxed">
                Click a coach for full profile, background, and booking.
              </p>
            </div>

            <a
              href={TRAINING_REQUEST_LINK}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-button border border-line bg-overlay-subtle px-5 text-small font-semibold text-ink transition hover:bg-overlay"
            >
              Request Training
            </a>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {trainingCoaches.map((c, i) => (
              <Link
                key={c.slug}
                href={`/training/coaches/${c.slug}`}
                className="group flex flex-col overflow-hidden rounded-card border border-line bg-overlay-subtle transition hover:bg-overlay"
              >
                <div className="shrink-0 border-b border-line px-4 pt-4 pb-3">
                  <div className="inline-flex h-8 min-w-8 items-center justify-center rounded-pill border border-line bg-overlay px-2.5 text-caption font-semibold tabular-nums text-ink">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                </div>

                <div className="px-4 pt-3 pb-4">
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card border border-line bg-canvas">
                    <CoachHeadshot
                      slug={c.slug}
                      name={c.name}
                      className="h-full w-full min-h-0"
                      imagePosition={c.imagePosition}
                      loading={i < 3 ? "eager" : "lazy"}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink via-ink to-transparent px-4 pb-3 pt-14">
                      <p className="text-small font-semibold text-ink sm:text-body">
                        {c.name}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-2 border-t border-line p-4 text-small">
                  <p className="font-semibold leading-snug text-ink">{c.college}</p>
                  <p className="text-ink">{c.position}</p>
                  <p className="text-muted leading-snug">
                    Hometown: {c.hometown || "Connecticut"}
                  </p>
                  <p className="text-muted leading-snug">
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
