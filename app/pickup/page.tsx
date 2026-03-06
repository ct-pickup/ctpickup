import Link from "next/link";

export default function PickupPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        {/* Top row */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">PICKUP</h1>
          <Link href="/" className="text-sm underline text-white/80">Home</Link>
        </div>

        {/* Request Access card (replaces where video used to be) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            PICKUP RUNS
          </div>

          <p className="text-white/80 max-w-3xl">
            Pickup runs use a tiered invite system. This is a competitive environment, not casual.
          </p>

          <div className="pt-2">
            <Link
              href="/pickup/intake"
              className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
            >
              REQUEST ACCESS
            </Link>
          </div>

          <p className="text-sm text-white/60">
            If approved, you’ll be added to the invite pool.
          </p>

          <p className="text-sm text-white/60">
            See below for eligibility, how it works, and rules.
          </p>
        </section>

        {/* Big wide hero video (second section) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <video
            className="block w-full h-[360px] md:h-[520px] object-cover"
            src="/pickup-hero.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        </section>

        {/* Details below */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">HOW IT WORKS</div>
            <div className="space-y-3 text-white/80">
              <p>Runs are invite-based through a tiered system.</p>
              <p>If a run reaches capacity, you will be confirmed or placed on standby.</p>
              <p>Confirmation and day-of updates include the exact location and details.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">ELIGIBILITY</div>
            <div className="space-y-3 text-white/80">
              <p>
                CT Pickup is intended for college players, former college players, high-level club players (ECNL, MLS Next),
                and varsity soccer players.
              </p>
              <p>Minimum age: 16.</p>
              <p className="text-sm text-white/60">
                If you do not meet the eligibility requirements, please email{" "}
                <a className="underline" href="mailto:pickupct@gmail.com">pickupct@gmail.com</a>{" "}
                and request a referral from a current player. While approval is likely, it is not guaranteed.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">RULES</div>
          <div className="space-y-2 text-white/80">
            <p>Maintain a competitive but respectful environment.</p>
            <p>Fights, threats, and disruptive behavior are not tolerated.</p>
            <p>Respect the game, the field, and all participants.</p>
            <p>
              <span className="font-semibold text-white/90">Slide tackles are strictly prohibited.</span>{" "}
              Violators will be removed and not invited to return.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
