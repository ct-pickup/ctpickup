import Link from "next/link";

const upcomingRuns = [
  {
    id: "ct",
    title: "Connecticut Run",
    date: "Saturday, Aug 17",
    time: "7:00 PM",
    level: "High-level / invite based",
    spotsLeft: 4,
  },
  {
    id: "ny",
    title: "New York Run",
    date: "Sunday, Aug 18",
    time: "6:30 PM",
    level: "College / Semi-Pro",
    spotsLeft: 7,
  },
  {
    id: "md",
    title: "Maryland Run",
    date: "Wednesday, Aug 21",
    time: "8:00 PM",
    level: "Invite only",
    spotsLeft: 2,
  },
  {
    id: "nj",
    title: "New Jersey Run",
    date: "Friday, Aug 23",
    time: "7:30 PM",
    level: "High-level",
    spotsLeft: 5,
  },
];

export default function UpcomingGamesPage() {
  return (
    <main className="py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold uppercase tracking-[0.18em] text-white">
            Upcoming Games
          </h1>

          <Link
            href="/pickup"
            className="text-sm font-medium text-white/70 hover:text-white"
          >
            Back
          </Link>
        </div>

        <p className="mb-6 text-sm text-white/70">
          Upcoming runs across locations.
        </p>

        <div className="space-y-4">
          {upcomingRuns.map((run) => (
            <section
              key={run.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
            >
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-white/50">
                    {run.title}
                  </p>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  </div>
                </div>

                <div className="md:pt-6">
                  <Link
                    href="/pickup/join-a-game"
                    className="inline-flex min-w-[160px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
                  >
                    View
                  </Link>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
