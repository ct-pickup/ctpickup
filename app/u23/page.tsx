import AutoSlider from "@/components/AutoSlider";
import { AutoplayHighlightVideo } from "@/components/u23/AutoplayHighlightVideo";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";

const APPLY_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSc6GTxVGfHtgJpiP_Vp_w2OPgMJteRd8AH9TK0Jeri_t9E4sw/viewform?usp=publish-editor";

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
      body: "Increased visibility through the Competitive Together network, including runs, staff, coaches, and affiliated teams.",
    },
  ];

  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-16">
      <TopNav
        backLabel="Back"
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <section className="mt-4 grid gap-5 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <Panel className="p-6 md:p-8 lg:p-9">
          <SectionEyebrow>Competitive Together</SectionEyebrow>

          <div className="mt-5 space-y-5">
            <h1 className="max-w-3xl text-h1 font-serif font-semibold text-ink md:text-display">
              U23 Select Team
            </h1>

            <p className="max-w-2xl text-body leading-7 text-muted md:text-h3 font-serif">
              A competitive U23 team formed through the Competitive Together network, built for
              high-level matches, structured training, and clear standards.
            </p>

            <div className="h-px w-full max-w-xl bg-overlay" />

            <div className="space-y-4 text-body leading-7 text-ink">
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
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch transition hover:opacity-90"
              >
                Apply Now
              </a>
            </div>

            <div className="pt-3">
              <p className="text-small text-muted">
                If selected, we will contact you directly.
              </p>
              <p className="mt-2 text-small text-muted">
                Not all applicants will be accepted. We are building the right team,
                not the biggest one.
              </p>
            </div>
          </div>
        </Panel>

        <Panel className="p-4 md:p-5">
          <div className="overflow-hidden rounded-card border border-line">
            <AutoSlider
              images={images}
              intervalMs={5000}
              aspectClassName="aspect-[4/5] md:aspect-[3/4]"
            />
          </div>

          <div className="space-y-1 px-1 pt-3">
            <p className="text-small font-medium text-ink md:text-body">
              U23 Select Team, 2025
            </p>
            <p className="text-caption text-muted md:text-small">Built through Competitive Together.</p>
          </div>
        </Panel>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Panel className="p-6 md:p-8">
          <SectionEyebrow>Standards</SectionEyebrow>
          <h2 className="mt-4 text-h3 font-serif font-semibold text-ink md:text-h2">
            High level, serious environment
          </h2>
          <p className="mt-4 text-body leading-7 text-muted">
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
                className="rounded-card border border-line bg-card p-4 md:p-5"
              >
                <h3 className="text-body font-semibold text-ink md:text-h3 font-serif">
                  {item.title}
                </h3>
                <p className="mt-3 text-small leading-6 text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="mt-6">
        <Panel className="p-6 md:p-8">
          <div className="max-w-2xl">
            <SectionEyebrow>Video Highlights</SectionEyebrow>
            <h2 className="mt-4 text-h2 font-serif font-semibold text-ink">
              2025 Summer Season
            </h2>
            <p className="mt-4 text-body leading-7 text-muted">
              Match footage from the U23 team. The presentation stays clean and cinematic,
              while the video itself remains bright and easy to watch.
            </p>
          </div>

          <div className="mt-8 grid gap-4">
            <div className="rounded-card border border-line bg-overlay-subtle p-3">
              <AutoplayHighlightVideo
                src="/u23-clip-1.mp4"
                label="U23 highlight clip 1"
              />
            </div>

            <div className="rounded-card border border-line bg-overlay-subtle p-3">
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
