import Link from "next/link";

export default function RulesPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold uppercase tracking-tight">RULES & ELIGIBILITY</h1>
          <Link href="/tournament" className="text-sm underline text-white/80">
            Back
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">ELIGIBILITY</div>
          <div className="space-y-3 text-white/80">
            <p>
              CT Pickup is intended for college players, former college players, and high-level club players (ECNL, MLS Next).
            </p>
            <p>Minimum age: 16.</p>
            <p>This is not a casual or low-intensity environment.</p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">RULES</div>

          <div className="space-y-2 text-white/80">
            <p>Maintain a competitive but respectful environment.</p>
            <p>Fights, threats, and disruptive behavior are not tolerated.</p>
            <p>Respect the game, the field, and all participants.</p>
            <p>
              <span className="font-semibold text-white/90">Slide tackles are strictly prohibited.</span> Violators will be removed and not invited to return.
            </p>
          </div>

          <p className="text-sm text-white/60 pt-2">
            Failure to meet eligibility or follow the rules you agreed to (including complaints about rules after agreeing) will result in a 30-day suspension or removal.
          </p>
        </section>

        <div className="pt-2">
          <Link href="/help#questions" className="underline text-white/80">
            FAQ
          </Link>
        </div>
      </div>
    </main>
  );
}
