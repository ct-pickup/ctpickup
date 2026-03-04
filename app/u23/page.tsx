import AutoSlider from "@/components/AutoSlider";

const APPLY_FORM = "https://forms.gle/4KMEreV6sjxHbTmw8";

export default function U23Page() {
  const images = [
    { src: "/u23-team.jpg", alt: "U23 Select Team" },
    // { src: "/u23-2.jpg", alt: "U23 Select Team" },
    // { src: "/u23-3.jpg", alt: "U23 Select Team" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <section className="space-y-10">
        <header className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight uppercase">U23 SELECT TEAM</h1>
          <p>
            A competitive U23 team formed through the CT Pickup network, built for high-level matches, structured
            training, and clear standards.
          </p>
        </header>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold uppercase">STANDARDS</h2>
          <p>
            We look for clean technical play under pressure and reliable communication. Humility and accountability
            matter. Commitment is required.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold uppercase">WHAT PLAYERS GET</h2>
          <div className="space-y-2">
            <p>
              <span className="font-semibold">Matches:</span> Curated games vs strong opponents (college, U23, semi-pro
              when possible).
            </p>
            <p>
              <span className="font-semibold">Training:</span> Organized sessions built around pace, structure, and
              accountability.
            </p>
            <p>
              <span className="font-semibold">Exposure:</span> Visibility through the CT Pickup network (runs, staff,
              coaches, affiliated teams).
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <AutoSlider images={images} intervalMs={5000} />
          <p className="text-sm opacity-80">U23 Select Team, 2025</p>
          <p className="text-xs opacity-70">Built through CT Pickup.</p>
        </div>

        <div className="space-y-2 pt-2">
          <a
            href={APPLY_FORM}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-black text-white"
          >
            APPLY
          </a>

          <p className="text-sm opacity-80">If selected, we will contact you directly.</p>
          <p className="text-xs opacity-70">
            Not all applicants will be accepted. We’re building the right team, not the biggest one.
          </p>

          {/* VIDEOS (under the not-all-applicants line) */}
          <div className="space-y-3 pt-4">
            <h3 className="text-lg font-semibold uppercase">VIDEOS</h3>

            <video className="w-full rounded-lg border border-black/10" controls preload="metadata">
              <source src="/u23-clip-1.mp4" type="video/mp4" />
            </video>

            <video className="w-full rounded-lg border border-black/10" controls preload="metadata">
              <source src="/u23-clip-2.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      </section>
    </main>
  );
}
