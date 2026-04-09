import { Panel } from "@/components/layout";

/**
 * Explains how the three esports legal documents work together (priority + cross-references).
 */
export function EsportsLegalReviewBlock() {
  return (
    <Panel className="border border-white/15 bg-white/[0.04] p-5 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/90">
        How these documents work together
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-white/75">
        Registration records acceptance of the{" "}
        <span className="text-white/90">Official Tournament Rules</span>,{" "}
        <span className="text-white/90">Terms and Conditions</span>, and{" "}
        <span className="text-white/90">Privacy and Publicity Consent Policy</span>. They include a
        shared priority rule: tournament-specific matters are governed by the Official Tournament
        Rules; privacy, publicity, and data-use matters by the Privacy and Publicity Consent Policy;
        general platform and account matters by the Terms; where documents conflict on the same
        topic, the more specific document controls. Dispute resolution and governing law are aligned
        across all three.
      </p>
    </Panel>
  );
}
