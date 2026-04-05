import AutoSlider from "@/components/AutoSlider";
import { AutoplayHighlightVideo } from "@/components/u23/AutoplayHighlightVideo";
import {
  AuthenticatedProfileMenu,
  HistoryBack,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";

const APPLY_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

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
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
      <TopNav
        fallbackHref={APP_HOME_URL}
        backLabel="Back"
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <section className="mt-4 grid gap-5 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <Panel className="p-6 md:p-8 lg:p-9">
          <SectionEyebrow>CT Pickup</SectionEyebrow>

          <div className="mt-5 space-y-5">
            <h1 className="max-w-3xl text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
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
                className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
              >
                Apply Now
              </a>

              <HistoryBack
                fallbackHref={APP_HOME_URL}
                className="inline-flex cursor-pointer items-center justify-center rounded-md border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              />
            </div>

            <div className="pt-3">
              <p className="text-sm text-white/65">
                If selected, we will contact you directly.
              </p>
              <p className="mt-2 text-sm text-white/50">
                Not all applicants will be accepted. We are building the right team,
                not the biggest one.
              </p>
            </div>
          </div>
        </Panel>

        <Panel className="p-4 md:p-5">
          <div className="overflow-hidden rounded-xl border border-white/15">
            <AutoSlider
              images={images}
              intervalMs={5000}
              aspectClassName="aspect-[4/5] md:aspect-[3/4]"
            />
          </div>

          <div className="space-y-1 px-1 pt-3">
            <p className="text-sm font-medium tracking-tight text-white/90 md:text-base">
              U23 Select Team, 2025
            </p>
            <p className="text-xs text-white/55 md:text-sm">Built through CT Pickup.</p>
          </div>
        </Panel>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Panel className="p-6 md:p-8">
          <SectionEyebrow>Standards</SectionEyebrow>
          <h2 className="mt-4 text-xl font-semibold uppercase tracking-tight text-white md:text-2xl">
            High level, serious environment
          </h2>
          <p className="mt-4 text-base leading-7 text-white/75">
            We value composure, intensity, and consistency. Players are expected to
            compete, communicate, and carry themselves with maturity every time they
            step on the field.
          </p>
        </Panel>

        <Panel className="p-6 md:p-8">
          <SectionEyebrow>What Players Get</SectionEyebrow>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {playerBenefits.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-white/15 bg-white/5 p-4 md:p-5"
              >
                <h3 className="text-base font-semibold text-white md:text-lg">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/70">{item.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="mt-6">
        <Panel className="p-6 md:p-8">
          <div className="max-w-2xl">
            <SectionEyebrow>Video Highlights</SectionEyebrow>
            <h2 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
              2025 Summer Season
            </h2>
            <p className="mt-4 text-base leading-7 text-white/72">
              Match footage from the U23 team. The presentation stays clean and cinematic,
              while the video itself remains bright and easy to watch.
            </p>
          </div>

          <div className="mt-8 grid gap-4">
            <div className="rounded-xl border border-white/15 bg-black/40 p-3">
              <AutoplayHighlightVideo
                src="/u23-clip-1.mp4"
                label="U23 highlight clip 1"
              />
            </div>

            <div className="rounded-xl border border-white/15 bg-black/40 p-3">
              <AutoplayHighlightVideo
                src="/u23-clip-2.mp4"
                label="U23 highlight clip 2"
              />
            </div>
          </div>
        </Panel>
      </section>
    </PageShell>
  );
}
