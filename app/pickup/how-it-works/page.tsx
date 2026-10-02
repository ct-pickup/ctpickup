import { HistoryBack } from "@/components/layout";

export default function HowItWorksPage() {
  return (
    <main className="py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-h1 font-serif font-bold text-ink">
            How It Works
          </h1>

          <HistoryBack
            fallbackHref="/pickup"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small font-medium text-muted transition hover:text-ink"
          />
        </div>

        <p className="mb-8 text-small text-muted">
          A structured system designed to keep runs competitive and organized.
        </p>

        <div className="space-y-5">
          <section className="rounded-card border border-line bg-card p-5">
            <p className="text-caption text-muted">
              01 — Request Access
            </p>
            <p className="mt-2 text-small text-ink">
              Join a run by submitting your info. Access depends on level, fit, and availability.
            </p>
          </section>

          <section className="rounded-card border border-line bg-card p-5">
            <p className="text-caption text-muted">
              02 — Selection
            </p>
            <p className="mt-2 text-small text-ink">
              Players are selected based on level, consistency, and overall run balance.
            </p>
          </section>

          <section className="rounded-card border border-line bg-card p-5">
            <p className="text-caption text-muted">
              03 — Confirm Spot
            </p>
            <p className="mt-2 text-small text-ink">
              Once selected, you confirm your spot. Payment may be required to lock in.
            </p>
          </section>

          <section className="rounded-card border border-line bg-card p-5">
            <p className="text-caption text-muted">
              04 — Play
            </p>
            <p className="mt-2 text-small text-ink">
              Show up, compete, and stay consistent to maintain access to future runs.
            </p>
          </section>

          <section className="rounded-card border border-line bg-card p-5">
            <p className="text-caption text-muted">
              Important
            </p>

            <div className="mt-3 space-y-2 text-small text-ink">
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
