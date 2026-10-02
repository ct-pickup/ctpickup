import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";

export default function TournamentHowItWorksPage() {
  return (
    <PageShell className="pb-16 pt-2">
      <TopNav
        fallbackHref="/tournament"
        backLabel="Tournament"
        rightSlot={<AuthenticatedProfileMenu />}
      />

      <div className="mx-auto max-w-3xl">
        <SectionEyebrow>Tournament</SectionEyebrow>
        <h1 className="mt-3 text-h2 font-serif font-bold text-ink sm:text-h1">
          How Tournaments Work
        </h1>

        <p className="mb-8 mt-4 text-small text-muted">
          A structured captain-based system built to keep tournament entry clear and organized.
        </p>

        <div className="space-y-4">
          <Panel className="space-y-2">
            <p className="text-caption font-semibold text-muted">
              01 — Claim Captain Spot
            </p>
            <p className="text-small text-ink">
              A captain submits their details and team info to claim one potential team place.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-caption font-semibold text-muted">
              02 — Payment Window
            </p>
            <p className="text-small text-ink">
              Payment is required within the allowed window to keep the team hold active.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-caption font-semibold text-muted">
              03 — Roster Verification
            </p>
            <p className="text-small text-ink">
              Players still need to be individually registered, reviewed, and verified.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <p className="text-caption font-semibold text-muted">
              04 — Final Approval
            </p>
            <p className="text-small text-ink">
              A team is only fully accepted after payment, eligibility review, roster review, and final approval.
            </p>
          </Panel>

          <Panel className="space-y-3">
            <p className="text-caption font-semibold text-muted">
              Important
            </p>

            <div className="space-y-2 text-small text-ink">
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
