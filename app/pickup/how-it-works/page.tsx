import { HistoryBack } from "@/components/layout";

export default function HowItWorksPage() {
  return (
    <main className="py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold uppercase tracking-[0.18em] text-white">
            How It Works
          </h1>

          <HistoryBack
            fallbackHref="/pickup"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm font-medium text-white/70 transition hover:text-white"
          />
        </div>

        <p className="mb-8 text-sm text-white/70">
          A structured system designed to keep runs competitive and organized.
        </p>

        <div className="space-y-5">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-white/50">
              01 — Request Access
            </p>
            <p className="mt-2 text-sm text-white/80">
              Join a run by submitting your info. Access depends on level, fit, and availability.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-white/50">
              02 — Selection
            </p>
            <p className="mt-2 text-sm text-white/80">
              Players are selected based on level, consistency, and overall run balance.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-white/50">
              03 — Confirm Spot
            </p>
            <p className="mt-2 text-sm text-white/80">
              Once selected, you confirm your spot. Payment may be required to lock in.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-white/50">
              04 — Play
            </p>
            <p className="mt-2 text-sm text-white/80">
              Show up, compete, and stay consistent to maintain access to future runs.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-white/50">
              Important
            </p>

            <div className="mt-3 space-y-2 text-sm text-white/80">
              <p>• Spots are limited and can fill quickly</p>
              <p>• Location is shared after confirmation</p>
              <p>• No-shows impact future eligibility</p>
              <p>• System prioritizes reliability and level</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
