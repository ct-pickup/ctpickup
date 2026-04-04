import Link from "next/link";

const CT_LOGO_SRC = "/ct-logo.png";

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-white"
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
      className="text-white/85"
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
    <main className="py-5">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-full border border-white/15 bg-white/6 px-5 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white/90 sm:text-base">
              Competitive · Together
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10">
              <UserIcon />
            </div>
          </div>
        </div>
      </div>

      <section className="flex min-h-[72vh] flex-col items-center justify-center text-center">
        <img
          src={CT_LOGO_SRC}
          alt="CT Pickup"
          className="w-[260px] md:w-[340px] h-auto object-contain"
        />

        <h1 className="mt-6 text-3xl font-bold tracking-[0.55em] text-white md:text-4xl">
          PICKUP
        </h1>

        <p className="mt-5 text-xs uppercase tracking-[0.28em] text-white/75 md:text-sm">
          Community. Culture. Competition.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="min-w-[160px] rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Log In
          </Link>

          <Link
            href="/signup"
            className="min-w-[160px] rounded-md border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            Sign Up
          </Link>
        </div>

        <div className="mt-8 flex items-center justify-center">
          <a
            href="https://instagram.com/ct.pickup"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 text-sm text-white/80"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10">
              <InstagramIcon />
            </span>
            <span className="font-medium">@ct.pickup</span>
          </a>
        </div>
      </section>
    </main>
  );
}
