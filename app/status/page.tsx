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
    label: "CONFIRMED",
    headline: "Tournament confirmed",
    blurb: "Date is locked. Details will be posted here first.",
    card: "border border-emerald-500/25 bg-emerald-500/10",
    pillActive: "border border-emerald-500/25 bg-emerald-500/15 text-emerald-200",
  },
  planning: {
    label: "PLANNING",
    headline: "Tournament planning",
    blurb: "We’re organizing the next tournament. Updates will be posted here first.",
    card: "border border-white/10 bg-white/[0.03]",
    pillActive: "border border-white/15 bg-white/10 text-white/85",
  },
  inactive: {
    label: "NOT ANNOUNCED",
    headline: "No tournament announced",
    blurb: "No tournament is currently scheduled.",
    card: "border border-red-500/25 bg-red-500/10",
    pillActive: "border border-red-500/25 bg-red-500/15 text-red-200",
  },
};

const ORDER: TourneyStatus[] = ["inactive", "planning", "confirmed"];

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="STATUS" />
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">

        {/* Main Status Card */}
        <section className={`rounded-2xl p-8 ${UI[tourneyStatus].card}`}>
          <div className="flex items-center gap-3">
            {/* Bigger pill */}
            <div
              className={`rounded-full px-4 py-2 text-sm font-semibold ${UI[tourneyStatus].pillActive}`}
            >
              {UI[tourneyStatus].label}
            </div>

            {/* Slightly bigger label */}
            <div className="text-sm uppercase tracking-widest text-white/55">
              Tournament status
            </div>
          </div>

          {/* Bigger headline */}
          <div className="mt-5 text-2xl font-semibold uppercase tracking-wide text-white/90">
            {UI[tourneyStatus].headline}
          </div>

          {/* Bigger blurb */}
          <p className="mt-2 text-base text-white/80 max-w-3xl">
            {UI[tourneyStatus].blurb}
          </p>

          {/* Three-state row (also bigger) */}
          <div className="mt-6 flex flex-wrap gap-2">
            {ORDER.map((k) => (
              <div
                key={k}
                className={[
                  "rounded-full px-4 py-2 text-sm border",
                  k === tourneyStatus ? UI[k].pillActive : "border-white/10 text-white/45",
                ].join(" ")}
              >
                {UI[k].label}
              </div>
            ))}
          </div>
        </section>

        {/* Updates box */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-3">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            Updates
          </div>
          <div className="text-base text-white/75">
            Updates will be posted here first. If something changes, check this page before messaging.
          </div>
        </section>
      </div>
    </main>
  );
}