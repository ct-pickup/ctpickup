import Link from "next/link";

/** Prominent return to the Training coaches grid (hash scroll). */
export function CoachProfileBackBar() {
  return (
    <nav aria-label="Back to coaches" className="mb-6 sm:mb-7">
      <Link
        href="/training#coaches"
        className="group flex min-h-[48px] w-full items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-left shadow-sm transition hover:border-white/20 hover:bg-white/[0.09] sm:min-h-[44px] sm:w-fit sm:py-2.5"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] text-white/80 transition group-hover:border-white/18 group-hover:text-white"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
            Training
          </span>
          <span className="mt-0.5 block text-sm font-semibold tracking-wide text-white/95">
            Back to coaches
          </span>
        </span>
      </Link>
    </nav>
  );
}
