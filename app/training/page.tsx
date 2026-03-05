import Link from "next/link";

type Coach = {
  name: string;
  experience: string;
  homeField: string;
};

const coaches: Coach[] = [
  { name: "COACH 1 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]" },
  { name: "COACH 2 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]" },
  { name: "COACH 3 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]" },
  { name: "COACH 4 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]" },
  { name: "COACH 5 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]" },
];

const GOOGLE_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

export default function TrainingPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-12 sm:py-14 space-y-12">
        {/* TOP ROW */}
        <header className="space-y-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-4">
              <h1 className="text-3xl font-semibold tracking-tight uppercase">TRAINING SESSIONS</h1>
              <p className="text-white/80 max-w-3xl">
                Small-group and 1:1 sessions focused on sharp touches, speed of play, and decision-making under pressure.
              </p>
            </div>

            <div className="sm:text-right space-y-2">
              <a
                href={GOOGLE_FORM}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
              >
                BOOK A SESSION
              </a>

              <p className="text-sm text-white/60">
                Open to all. We’ll reply with next steps.
              </p>
            </div>
          </div>

          {/* VIDEO */}
          <div className="mt-2 flex justify-center">
            <div className="relative w-full max-w-[620px]">
              <div
                className="absolute -inset-3 rounded-2xl border border-white/10"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                }}
              />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <video
                  className="block w-full h-auto"
                  src="/training-hero.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                />
              </div>
            </div>
          </div>
        </header>

        {/* MID GRID (your exact format) */}
        <section className="grid gap-10 lg:grid-cols-2">
          {/* Row 1: Coaching (L) */}
          <div className="space-y-3">
            <h2 className="text-xl font-semibold uppercase">COACHING</h2>
            <p className="text-white/80 max-w-xl">
              You may book sessions with one or multiple coaches. All coaches have collegiate playing experience.
            </p>
          </div>

          {/* Row 1: Location (R) */}
          <div className="space-y-3">
            <h2 className="text-xl font-semibold uppercase">LOCATION</h2>
            <p className="text-white/80 max-w-xl">
              Sessions are held at the coach’s home field. Players within a 30-minute drive are considered within the standard service area.
            </p>
          </div>

          {/* Row 2: Expectations (L) */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold uppercase">EXPECTATIONS</h3>
            <p className="text-white/80 max-w-xl">
              Show up ready to work, respect the pace, and be on time.
            </p>
          </div>

          {/* Row 2: Pricing (R) */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold uppercase">PRICING</h3>
            <p className="text-white/80 max-w-xl">
              Pricing varies by coach.
            </p>
          </div>

          {/* Row 3: Travel Add-On (L) */}
          <div className="space-y-3">
            <h2 className="text-xl font-semibold uppercase">TRAVEL ADD-ON (IF THE COACH TRAVELS TO YOU)</h2>
            <p className="text-white/80 max-w-xl">
              If you request a coach to travel outside their standard service area, a travel add-on fee applies.
            </p>
            <ul className="list-disc pl-6 space-y-1 text-white/80 max-w-xl">
              <li>0–15 min: $0</li>
              <li>15–30 min: +$10</li>
              <li>30–45 min: +$20</li>
              <li>Over 45 minutes: Pricing is determined on a case-by-case basis.</li>
            </ul>
          </div>

          {/* Row 3: Notes (R) */}
          <div className="space-y-2 lg:text-right">
            <p className="text-sm text-white/60 italic">
              Travel time is calculated based on the estimated drive time from the coach’s home field.
            </p>
            <p className="text-sm text-white/60 italic">
              This approach establishes clear expectations and helps prevent misunderstandings.
            </p>
          </div>
        </section>

        {/* COACHES */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold uppercase">COACHES</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coaches.map((c) => (
              <div key={c.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
                <div className="h-40 w-full rounded-md bg-white/5" />
                <div className="space-y-1">
                  <div className="font-semibold uppercase">{c.name}</div>
                  <div className="text-sm text-white/80">{c.experience}</div>
                  <div className="text-sm text-white/80">{c.homeField}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
          >
            HOME
          </Link>
        </div>
      </div>
    </main>
  );
}
