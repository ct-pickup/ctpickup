"use client";

import Link from "next/link";

const CT_LOGO_SRC = "/ct-logo.png";

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
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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
      <path
        d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M17.5 6.5h.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between">
          <div className="font-semibold tracking-wide uppercase">
            COMPETITIVE · TOGETHER
          </div>

          <div className="h-9 w-9 rounded-full border border-black/15 flex items-center justify-center">
            <UserIcon />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <section className="relative mt-10 flex min-h-[72vh] items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/5 to-transparent" />

          <div className="relative w-full max-w-xl text-center">
            <div className="flex justify-center">
              <img
                src={CT_LOGO_SRC}
                alt="CT Pickup"
                className="w-[360px] md:w-[460px] h-auto object-contain"
              />
            </div>

            <div className="mt-6 text-white uppercase font-semibold tracking-[0.9em] text-2xl md:text-3xl">
              P I C K U P
            </div>

            <p className="mt-6 text-base md:text-lg font-semibold uppercase tracking-wide text-white/85">
              COMMUNITY. CULTURE. COMPETITION.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3">
              <Link
                href="/login"
                className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black"
              >
                LOG IN
              </Link>

              <Link
                href="/signup"
                className="rounded-md border border-white/15 bg-white/5 px-7 py-3 text-sm font-semibold text-white"
              >
                SIGN UP
              </Link>
            </div>

            <div className="mt-8 flex items-center justify-center text-sm text-white/85">
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
          </div>
        </section>
      </div>
    </main>
  );
}
