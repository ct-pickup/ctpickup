import Link from "next/link";

export default function JoinAGamePage() {
  const run = {
    title: "CT Pickup Run",
    date: "Saturday, Aug 17",
    time: "7:00 PM",
    location: "Hidden until confirmed",
    level: "High-level / invite based",
    spotsLeft: 4,
    status: "Open",
  };

  const myStatus = "Not joined yet";

  return (
    <main className="py-8">
      <div className="mx-auto max-w-3xl">
        
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold uppercase tracking-[0.18em] text-white">
            Join A Game
          </h1>

          <Link
            href="/pickup"
            className="text-sm font-medium text-white/70 hover:text-white"
          >
            Back
          </Link>
        </div>

        <p className="mb-6 text-sm text-white/70">
          Reserve a spot for the next active run.
        </p>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/50">
                Current Run
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {run.title}
              </h2>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Date</p>
                <p className="mt-2 text-base font-medium text-white">{run.date}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Time</p>
                <p className="mt-2 text-base font-medium text-white">{run.time}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Level</p>
                <p className="mt-2 text-base font-medium text-white">{run.level}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Spots Left</p>
                <p className="mt-2 text-base font-medium text-white">{run.spotsLeft}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Location</p>
                <p className="mt-2 text-base font-medium text-white">{run.location}</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-white/50">
              Your Status
            </p>
            <p className="mt-3 text-lg font-medium text-white">{myStatus}</p>

            <div className="mt-6">
              <Link
                href="/pickup/intake"
                className="inline-flex min-w-[200px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
              >
                Continue
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
