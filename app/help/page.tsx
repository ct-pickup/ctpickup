import Link from "next/link";
import PageTop from "@/components/PageTop";

const EMAIL = "pickupct@gmail.com";

function ButtonLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold bg-white text-black w-full sm:w-auto"
    >
      {label}
    </Link>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold uppercase tracking-wide text-white/85">
        {q}
      </div>
      <p className="text-white/75 leading-relaxed">{a}</p>
    </div>
  );
}

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="HELP" />
      <div className="mx-auto max-w-5xl px-6 py-14 space-y-10">
        {/* Top row */}
        <div className="flex items-start justify-between gap-6">
          <div className="text-4xl md:text-5xl font-semibold uppercase tracking-tight text-white leading-none">
            HELP
          </div>

          <div className="text-right space-y-2">
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/60">
                CONTACT
              </div>
              <a
                href={`mailto:${EMAIL}`}
                className="text-sm font-semibold underline text-white/85"
              >
                {EMAIL}
              </a>
            </div>

            <a href="#questions" className="text-sm font-semibold underline text-white/80">
              Questions
            </a>
          </div>
        </div>

        {/* Quick answers */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            QUICK ANSWERS
          </div>

          <div className="space-y-3 text-white/80">
            <p>
              <span className="font-semibold text-white/90">Status:</span>{" "}
              Pickup and tournament updates live on the Status pages.
            </p>
            <p>
              <span className="font-semibold text-white/90">Training:</span>{" "}
              Booking and details are on the Training Sessions page.
            </p>
            <p>
              <span className="font-semibold text-white/90">Response time:</span>{" "}
              We reply with next steps as soon as possible.
            </p>
          </div>
        </section>

        {/* Standards */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            STANDARDS
          </div>
          <div className="space-y-3 text-white/80">
            <p>Competitive environment. Clean play under pressure.</p>
            <p>Reliable communication. No ego. Respect the pace.</p>
            <p>Show up on time. If you can’t make it, say it early.</p>
          </div>
        </section>

        {/* Programs */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            LOOKING FOR PROGRAMS?
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ButtonLink href="/training" label="TRAINING" />
            <ButtonLink href="/u23" label="U23 SELECT TEAM" />
            <ButtonLink href="/tournament" label="TOURNAMENT" />
            <ButtonLink href="/pickup" label="PICKUP" />
            <ButtonLink href="/status/tournament" label="STATUS" />
          </div>
        </section>

        {/* Questions */}
        <section
          id="questions"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 space-y-7"
        >
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
            QUESTIONS
          </div>

          <div className="space-y-7">
            <QA
              q="Who is CT Pickup for?"
              a="CT Pickup is intended for college players, former college players, and high-level club players (ECNL, MLS Next). The minimum age is 16. This is not a casual or low-intensity environment."
            />

            <QA
              q="How do I RSVP?"
              a="RSVP is required only for tournaments. Pickup runs use a tiered invite system. If a run reaches capacity, you will be confirmed or placed on standby."
            />

            <QA
              q="Is there a lateness cutoff?"
              a="Yes. If you are running late, please notify us. Consistent lateness will result in lower priority for capped runs."
            />

            <QA
              q="What are the basic behavior rules?"
              a="Maintain a competitive but respectful environment. Fights, threats, and disruptive behavior are not tolerated. Respect the game, the field, and all participants. Slide tackles are strictly prohibited. Violators will be removed and not invited to return."
            />

            <QA
              q="How do announcements go out (text, email, Instagram)?"
              a="Primary updates are communicated via Instagram and direct messages. Confirmation and day-of messages provide essential run information."
            />
          </div>
        </section>

        <div className="pt-2">
          <Link href="/" className="inline-flex underline text-white/80">
            HOME
          </Link>
        </div>
      </div>
    </main>
  );
}
