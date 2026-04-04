import {
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
const SIDE_IMAGE = "/mission/side.jpg";

export default function MissionPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav brandHref="/after-login" backHref="/after-login" />

      <div className="grid items-center gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,620px)_280px] lg:gap-10">
        <Panel className="p-6 md:p-8 lg:p-10">
          <div className="max-w-[620px]">
            <SectionEyebrow>CT Pickup</SectionEyebrow>

            <h1 className="mt-4 text-3xl font-semibold uppercase tracking-tight text-white md:text-5xl">
              Our Mission
            </h1>

            <div className="mt-8 space-y-8 border-l border-white/15 pl-5 text-base leading-relaxed text-white/80 md:pl-8 md:text-lg">
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
