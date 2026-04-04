import {
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";

export default function TournamentHowItWorksPage() {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav backHref="/tournament" backLabel="Tournament" />

      <div className="pt-2">
        <SectionEyebrow>Tournament</SectionEyebrow>
        <h1 className="mt-3 text-2xl font-bold uppercase tracking-[0.14em] text-white sm:text-3xl">
          How Tournaments Work
        </h1>

        <p className="mb-8 mt-4 text-sm text-white/70">
          A structured captain-based system built to keep tournament entry clear and organized.
        </p>

        <div className="space-y-4">
          <Panel className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              01 — Claim Captain Spot
            </p>
            <p className="text-sm text-white/80">
              A captain submits their details and team info to claim one potential team place.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              02 — Payment Window
            </p>
            <p className="text-sm text-white/80">
              Payment is required within the allowed window to keep the team hold active.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              03 — Roster Verification
            </p>
            <p className="text-sm text-white/80">
              Players still need to be individually registered, reviewed, and verified.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              04 — Final Approval
            </p>
            <p className="text-sm text-white/80">
              A team is only fully accepted after payment, eligibility review, roster review, and final approval.
            </p>
          </Panel>

          <Panel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              Important
            </p>

            <div className="space-y-2 text-sm text-white/80">
              <p>• Claiming a captain spot does not automatically confirm the team</p>
              <p>• Team spots are limited</p>
              <p>• Payment deadlines matter</p>
              <p>• Final approval depends on roster verification and eligibility</p>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
