import Link from "next/link";

const CT_LOGO_SRC = "/ct-logo.png"; // file: public/ct-logo.png

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-black/60"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-white/80"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M17.5 6.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function InfoCard({
  title,
  desc,
  href,
  cta,
}: {
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-7">
      <div className="text-sm font-semibold uppercase tracking-wide text-white/90">
        {title}
      </div>
      <p className="mt-3 text-sm text-white/70 leading-relaxed">{desc}</p>
      <div className="mt-4">
        <Link href={href} className="text-sm font-semibold underline text-white/85">
          {cta}
        </Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      {/* remove details marker */}
      <style>{`
        details summary::-webkit-details-marker { display: none; }
        details summary { list-style: none; }
      `}</style>

      {/* Top Nav */}
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between">
          <div className="font-semibold tracking-wide uppercase">
            COMPETITIVE · TOGETHER
          </div>

          <div className="flex items-center gap-6">
            {/* STATUS (click opens). Only PICKUP/TOURNAMENT are clickable */}
            <details className="relative">
              <summary className="text-sm font-medium tracking-wide cursor-pointer select-none">
                STATUS
              </summary>

              {/* Dropdown opens left so it won't be covered by the icon */}
              <div className="absolute right-0 mt-3 w-44 rounded-xl border border-black/10 bg-white text-black shadow-lg z-50">
                <Link
                  href="/status/pickup"
                  className="block px-4 py-3 text-sm font-semibold hover:bg-black/5 rounded-t-xl"
                  title="Pickup status"
                >
                  PICKUP
                </Link>
                <Link
                  href="/status/tournament"
                  className="block px-4 py-3 text-sm font-semibold hover:bg-black/5 rounded-b-xl"
                  title="Tournament status"
                >
                  TOURNAMENT
                </Link>
              </div>
            </details>

            <Link href="/help" className="text-sm font-medium tracking-wide">
              HELP
            </Link>

            {/* top-right icon (kept). not clickable, so it won't interfere */}
            <div className="h-9 w-9 rounded-full border border-black/15 flex items-center justify-center pointer-events-none">
              <UserIcon />
            </div>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="mx-auto max-w-6xl px-6">
        <section className="relative mt-10 flex min-h-[72vh] items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/5 to-transparent" />

          <div className="relative w-full max-w-xl text-center">
            <div className="flex justify-center">
              <img
                src={CT_LOGO_SRC}
                alt="CT"
                className="w-[360px] md:w-[460px] h-auto object-contain"
              />
            </div>

            <div className="mt-6 text-white uppercase font-semibold tracking-[0.9em] text-2xl md:text-3xl">
              P I C K U P
            </div>

            <p className="mt-6 text-base md:text-lg font-semibold uppercase tracking-wide text-white/85">
              SELECT PICKUP. PUBLIC TOURNAMENTS.
            </p>

            <div className="mt-7 flex items-center justify-center">
              <Link
                href="/login"
                className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black"
              >
                LOG IN
              </Link>
            </div>

            {/* IG handle only (no View Status on the right) */}
            <div className="mt-6 flex items-center justify-start text-sm text-white/85">
              <a
                href="https://instagram.com/ct.pickup"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-white/5">
                  <InstagramIcon />
                </span>
                <span className="font-semibold">ct.pickup</span>
              </a>
            </div>

            <div className="mt-12">
              <a
                href="#info"
                className="text-xs font-semibold uppercase tracking-widest text-white/60"
              >
                SCROLL
              </a>
            </div>
          </div>
        </section>
      </div>

      {/* BELOW THE FOLD */}
      <div id="info" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.03] p-10">
          <div className="text-xl md:text-2xl font-semibold uppercase tracking-wide text-white/60 text-center">
            OUR MISSION
          </div>

          <div className="mt-6 text-center max-w-3xl mx-auto space-y-5">
            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              CT Pickup began with a simple idea: if the best soccer is hard to access, build a place where it isn’t.
            </p>
            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              What started as a way to get consistent, competitive runs has become a community, a network, and a standard. Players connect, improve, and look out for each other.
            </p>
            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              We keep it open, keep it real, and keep growing.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 max-w-4xl mx-auto">
            <InfoCard
              title="U23 SELECT TEAM"
              desc="High-level matches, structured training, and clear standards. Invite-based."
              href="/u23"
              cta="VIEW INFO / APPLY"
            />
            <InfoCard
              title="TRAINING SESSIONS"
              desc="Small-group and 1:1 sessions. Booking is open to anyone."
              href="/training"
              cta="VIEW INFO"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
