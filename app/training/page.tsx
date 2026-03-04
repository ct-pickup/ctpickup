import Link from "next/link";

type Coach = {
  name: string;
  experience: string; // "College / Position"
  homeField: string;  // "Norwalk, CT"
  travel: string;     // "Up to 45 min"
};

const coaches: Coach[] = [
  { name: "COACH 1 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]", travel: "Travel: Up to 45 min" },
  { name: "COACH 2 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]", travel: "Travel: Up to 45 min" },
  { name: "COACH 3 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]", travel: "Travel: Up to 45 min" },
  { name: "COACH 4 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]", travel: "Travel: Up to 45 min" },
  { name: "COACH 5 NAME", experience: "Experience: [College / Position]", homeField: "Home field: [Town/Area, State]", travel: "Travel: Up to 45 min" },
];

const BOOK_EMAIL = "pickupct@gmail.com";
const SUBJECT = "CT Pickup Training Session Request";
const GOOGLE_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

export default function TrainingPage() {
  const mailto = `mailto:${BOOK_EMAIL}?subject=${encodeURIComponent(SUBJECT)}`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <section className="space-y-10">
        <header className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight uppercase">TRAINING SESSIONS</h1>
          <p className="text-lg">
            Small-group and 1:1 sessions focused on sharp touches, speed of play, and decision-making under pressure.
          </p>
        </header>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold uppercase">COACHING</h2>
          <p>
            Book with one coach or multiple. Every coach has played at the college level.
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold uppercase">LOCATION</h3>
            <p>
              Sessions are held at the coach’s home field. Most players should expect to drive. If you are within
              approximately 45 minutes, you are within the standard service area.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold uppercase">TRAVEL ADD-ON (IF THE COACH TRAVELS TO YOU)</h3>
            <p>If you request a coach to travel outside their standard area, a travel add-on fee will apply.</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>0–15 min: $0</li>
              <li>15–30 min: +$10</li>
              <li>30–45 min: +$20</li>
              <li>Over 45 minutes: Pricing determined on a case-by-case basis.</li>
            </ul>
            <p className="text-sm opacity-80">
              Travel time is calculated based on the estimated drive time from the coach’s home field.
            </p>
            <p className="text-sm opacity-80">
              This approach establishes clear expectations and helps prevent misunderstandings.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <a
            href={mailto}
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-black text-white"
          >
            BOOK A SESSION
          </a>

          <div>
            <a href={GOOGLE_FORM} target="_blank" rel="noreferrer" className="text-sm underline opacity-90">
              Google Form
            </a>
          </div>

          <p className="text-sm opacity-80">Open to anyone. We’ll reply with next steps.</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold uppercase">EXPECTATIONS</h3>
          <p>Show up ready to work, respect the pace, and be on time.</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold uppercase">PRICING</h3>
          <p>Pricing varies by coach.</p>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold uppercase">COACHES</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coaches.map((c) => (
              <div key={c.name} className="rounded-lg border border-black/10 p-4 space-y-2">
                <div className="h-40 w-full rounded-md bg-black/5" />

                <div className="space-y-1">
                  <div className="font-semibold uppercase">{c.name}</div>
                  <div className="text-sm">{c.experience}</div>
                  <div className="text-sm">{c.homeField}</div>
                  <div className="text-sm">{c.travel}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-6">
          <Link className="underline text-sm" href="/u23">
            U23 SELECT TEAM
          </Link>
        </div>
      </section>
    </main>
  );
}
