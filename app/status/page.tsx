import Link from "next/link";
import PageTop from "@/components/PageTop";

type TourneyStatus = "confirmed" | "planning" | "inactive";

/**
 * Change this one line whenever needed:
 * - "inactive"  = not announced (red)
 * - "planning"  = planning (gray)
 * - "confirmed" = confirmed (green)
 */
const tourneyStatus: TourneyStatus = "planning";

const UI: Record<
  TourneyStatus,
  {
    label: string;
    headline: string;
    blurb: string;
    card: string;
    pillActive: string;
  }
> = {
  confirmed: {
    label: "Confirmed",
    headline: "Tournament confirmed",
    blurb: "Date is locked. Details will be posted here first.",
    card: "border border-pitch bg-pitch-panel",
    pillActive: "border border-pitch bg-pitch-panel text-on-pitch-panel",
  },
  planning: {
    label: "Planning",
    headline: "Tournament planning",
    blurb: "We’re organizing the next tournament. Updates will be posted here first.",
    card: "border border-line bg-overlay-subtle",
    pillActive: "border border-line bg-overlay text-ink",
  },
  inactive: {
    label: "Not announced",
    headline: "No tournament announced",
    blurb: "No tournament is currently scheduled.",
    card: "border border-coral bg-overlay-subtle",
    pillActive: "border border-coral bg-overlay-subtle text-coral-text",
  },
};

const ORDER: TourneyStatus[] = ["inactive", "planning", "confirmed"];

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageTop title="STATUS" fallbackHref="/" />
      <div className="mx-auto max-w-5xl px-5 py-14 space-y-10">

        {/* Main Status Card */}
        <section className={`rounded-card p-8 ${UI[tourneyStatus].card}`}>
          <div className="flex items-center gap-3">
            {/* Bigger pill */}
            <div
              className={`rounded-pill px-4 py-2 text-small font-semibold ${UI[tourneyStatus].pillActive}`}
            >
              {UI[tourneyStatus].label}
            </div>

            {/* Slightly bigger label */}
            <div className="text-small text-muted">
              Tournament status
            </div>
          </div>

          {/* Bigger headline */}
          <div className="mt-5 text-h2 font-serif font-semibold text-ink">
            {UI[tourneyStatus].headline}
          </div>

          {/* Bigger blurb */}
          <p className="mt-2 text-body text-ink max-w-3xl">
            {UI[tourneyStatus].blurb}
          </p>

          {/* Three-state row (also bigger) */}
          <div className="mt-6 flex flex-wrap gap-2">
            {ORDER.map((k) => (
              <div
                key={k}
                className={[
                  "rounded-pill px-4 py-2 text-small border",
                  k === tourneyStatus ? UI[k].pillActive : "border-line text-muted",
                ].join("  ")}
              >
                {UI[k].label}
              </div>
            ))}
          </div>
        </section>

        {/* Updates box */}
        <section className="rounded-card border border-line bg-card p-8 space-y-3">
          <div className="text-small font-semibold text-muted">
            Updates
          </div>
          <div className="text-body text-muted">
            Updates will be posted here first. If something changes, check this page before messaging.
          </div>
        </section>
      </div>
    </main>
  );
}