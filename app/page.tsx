import Link from "next/link";
import SideMenu from "@/components/SideMenu";

const CT_LOGO_SRC = "/ct-logo.png"; // put your CT logo in /public as ct-logo.png

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white/80" aria-hidden="true">
      <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M17.5 6.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between">
          <div className="font-semibold tracking-wide uppercase">COMPETITIVE · TOGETHER</div>
          <SideMenu />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <section className="relative mt-10 flex min-h-[72vh] items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/5 to-transparent" />

          <div className="relative w-full max-w-xl text-center">
            <div className="flex justify-center">
              <img src={CT_LOGO_SRC} alt="CT" className="w-[360px] md:w-[460px] h-auto object-contain" />
            </div>

            <div className="mt-6 text-white uppercase font-semibold tracking-[0.9em] text-2xl md:text-3xl">
              P I C K U P
            </div>

            <p className="mt-6 text-base md:text-lg font-semibold uppercase tracking-wide text-white/85">
              COMMUNITY. CULTURE. COMPETITION.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-2">
              <Link href="/login" className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black">
                LOG IN
              </Link>

              <div className="text-xs text-white/60">
                Required to save your info and access invite-only run details.
              </div>

              <Link href="/signup" className="text-xs underline text-white/70 hover:text-white">
                New? Create account
              </Link>
            </div>

            <div className="mt-6 flex items-center justify-start text-sm text-white/85">
              <a href="https://instagram.com/ct.pickup" target="_blank" rel="noreferrer" className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-white/5">
                  <InstagramIcon />
                </span>
                <span className="font-semibold">ct.pickup</span>
              </a>
            </div>
          </div>
        </section>
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-10">
          <div className="text-3xl md:text-4xl font-semibold uppercase tracking-wide text-white/60 text-center">
            OUR MISSION
          </div>

          <div className="mt-6 text-center max-w-3xl mx-auto space-y-5">
            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              CT Pickup exists to make high-level soccer easier to access without lowering the standard.
            </p>

            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              What began as a few competitive games has grown into a network where dedicated players connect, develop their skills, and support one another.
            </p>

            <p className="text-base md:text-lg font-semibold text-white/90 leading-relaxed">
              We keep sessions open when possible and curate them as needed to maintain quality. Our continued growth depends on your involvement.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
