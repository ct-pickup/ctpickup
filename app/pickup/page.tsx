import Link from "next/link";

export default function PickupPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">PICKUP</h1>
          <Link href="/" className="text-sm underline text-white/80">Home</Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            HOW PICKUP WORKS
          </div>

          <div className="space-y-3 text-white/80">
            <p>
              CT Pickup runs use a tiered invite system. This is a competitive environment, not casual.
            </p>
            <p>
              If a run reaches capacity, you will be confirmed or placed on standby.
            </p>
            <p>
              Eligibility: college / former college / ECNL / MLS Next. Minimum age: 16.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/pickup/intake"
              className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
            >
              REQUEST ACCESS
            </Link>
          </div>

          <div className="text-sm text-white/60">
            If approved, you’ll be added to the invite pool.
          </div>
        </section>
      </div>
    </main>
  );
}
