import Link from "next/link";

export default function TournamentPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">TOURNAMENTS</h1>
          <Link href="/" className="text-sm underline text-white/80">
            Home
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            TOURNAMENT AVAILABILITY
          </div>

          <p className="text-white/80">
            Public tournaments hosted through CT Pickup. Submit your availability and we’ll follow up with details.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/tournament/intake"
              className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
            >
              SUBMIT AVAILABILITY
            </Link>

            <Link href="/status/tournament" className="text-sm underline text-white/80">
              Tournament Status
            </Link>
          </div>

          <p className="text-sm text-white/60">
            If capacity is reached, you may be confirmed or placed on standby.
          </p>
        </section>
      </div>
    </main>
  );
}
