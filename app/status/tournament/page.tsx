import Link from "next/link";

export default function TournamentStatusPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">STATUS</h1>
          <Link href="/" className="text-sm underline text-white/80">
            Back
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
            Tournament Status
          </div>
          <div className="mt-4 text-lg font-semibold text-white/90">
            In progress.
          </div>
          <div className="mt-2 text-sm text-white/60">
            We are organizing the next tournament. Updates will be posted here first.
          </div>
        </section>
      </div>
    </main>
  );
}
