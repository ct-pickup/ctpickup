import AutoSlider from "@/components/AutoSlider";

const APPLY_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

export default function U23Page() {
  const images = [
    { src: "/u23-team.jpg", alt: "U23 Select Team" },
    // { src: "/u23-1.jpg", alt: "U23 Select Team" },
    // { src: "/u23-2.jpg", alt: "U23 Select Team" },
  ];

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <section className="space-y-10">
          <header className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight uppercase">U23 SELECT TEAM</h1>
            <p className="text-white/80">
              A competitive U23 team formed through the CT Pickup network, built for high-level matches, structured
              training, and clear standards.
            </p>

            {/* PHOTO BLOCK (moved directly under the description) */}
            <div className="space-y-2">
              <AutoSlider images={images} intervalMs={5000} />
              <p className="text-sm text-white/60">U23 Select Team, 2025</p>
              <p className="text-xs text-white/50">Built through CT Pickup.</p>
            </div>
          </header>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold uppercase">STANDARDS</h2>
            <p className="text-white/80">
              We look for clean technical play under pressure and reliable communication. Humility and accountability
              matter. Commitment is required.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold uppercase">WHAT PLAYERS GET</h2>
            <div className="space-y-2 text-white/80">
              <p>
                <span className="font-semibold text-white/90">Matches:</span> Curated games vs strong opponents (college,
                U23, semi-pro when possible).
              </p>
              <p>
                <span className="font-semibold text-white/90">Training:</span> Organized sessions built around pace,
                structure, and accountability.
              </p>
              <p>
                <span className="font-semibold text-white/90">Exposure:</span> Visibility through the CT Pickup network
                (runs, staff, coaches, affiliated teams).
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <a
              href={APPLY_FORM}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black"
            >
              APPLY
            </a>

            <p className="text-sm text-white/60">If selected, we will contact you directly.</p>
            <p className="text-xs text-white/50">
              Not all applicants will be accepted. We’re building the right team, not the biggest one.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
