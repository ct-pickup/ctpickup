import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
const SIDE_IMAGE = "/mission/side.jpg";

export default function MissionPage() {
  return (
    <PageShell maxWidthClass="max-w-6xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="grid items-center gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,620px)_280px] lg:gap-10">
        <Panel className="p-6 md:p-8 lg:p-10">
          <div className="max-w-[620px]">
            <SectionEyebrow>Competitive Together</SectionEyebrow>

            <h1 className="mt-4 text-h1 font-serif font-semibold text-ink md:text-display">
              Our Mission
            </h1>

            <div className="mt-8 space-y-8 border-l border-line pl-5 text-body leading-relaxed text-ink md:pl-8 md:text-h3 font-serif">
              <p>
                Competitive Together exists to make high-level soccer easier to access without
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
              alt="Competitive Together"
              className="h-[520px] w-full object-cover grayscale opacity-50"
            />
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
