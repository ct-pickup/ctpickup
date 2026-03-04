import Link from "next/link";

export default function PickupStatusPage() {
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
            Pickup Status
          </div>
          <div className="mt-4 text-lg font-semibold text-white/90">
            There are currently no updates.
          </div>
          <div className="mt-2 text-sm text-white/60">
            Updates will be posted here when runs are confirmed or modified.
          </div>
        </section>
      </div>
    </main>
  );
}
