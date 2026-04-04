import { notFound } from "next/navigation";
import { CoachHeadshot } from "@/components/training/CoachHeadshot";
import {
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { trainingCoaches } from "@/lib/trainingCoaches";

export default async function CoachPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const coach = trainingCoaches.find((c) => c.slug === slug);

  if (!coach) notFound();

  return (
    <PageShell>
      <TopNav backHref="/training" backLabel="Training" />

      <div className="mb-8">
        <SectionEyebrow>Training</SectionEyebrow>
        <h1 className="mt-3 text-2xl font-bold uppercase tracking-[0.18em] text-white sm:text-3xl md:tracking-[0.22em]">
          {coach.name}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(240px,320px)_1fr] lg:items-start lg:gap-8">
        <CoachHeadshot
          src={coach.image}
          alt={coach.name}
          sizes="(max-width:1024px) 100vw, 320px"
          className="aspect-[4/5] w-full max-w-sm mx-auto lg:mx-0 rounded-2xl border border-white/15 bg-[#141415]"
          imagePosition={coach.imagePosition}
          priority
        />

        <div className="space-y-4">
          <Panel>
            <SectionEyebrow>Experience</SectionEyebrow>
            <p className="mt-3 text-sm leading-relaxed text-white/80 sm:text-base">
              {coach.experience}
            </p>

            <div className="mt-8">
              <SectionEyebrow>Coaching Background</SectionEyebrow>
              <p className="mt-3 text-sm leading-relaxed text-white/80 sm:text-base">
                {coach.coaching}
              </p>
            </div>
          </Panel>

          <Panel>
            <SectionEyebrow>Specialty</SectionEyebrow>
            <p className="mt-3 text-sm leading-relaxed text-white sm:text-base">
              {coach.specialty}
            </p>

            <div className="mt-6">
              <SectionEyebrow>Hometown</SectionEyebrow>
              <p className="mt-3 text-sm text-white sm:text-base">
                {coach.hometown || "Connecticut"}
              </p>
            </div>

            <div className="mt-8">
              <a
                href={coach.bookingLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-5 text-sm font-semibold text-black transition hover:opacity-90"
              >
                Request {coach.name}
              </a>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
