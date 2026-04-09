import { Panel } from "@/components/layout";

/**
 * Pre-launch blocker: uploaded legal drafts appear inconsistent on dispute resolution.
 * Do not remove until counsel reconciles Official Rules vs Participant Terms.
 */
export function EsportsLegalReviewBlock() {
  return (
    <Panel className="border border-amber-400/30 bg-amber-400/[0.07] p-5 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-100/95">
        Legal review required (dispute resolution)
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-amber-50/90">
        Before launch, counsel should reconcile how disputes are resolved: the{" "}
        <span className="text-white/95">Official Tournament Rules</span> describe binding
        arbitration (including JAMS rules and Hartford County), while the{" "}
        <span className="text-white/95">Participant Terms</span> describe exclusive venue in
        Connecticut state and federal courts. Users should not be asked to accept both as
        written until these provisions are aligned.
      </p>
    </Panel>
  );
}
