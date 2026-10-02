import Link from "next/link";

/** Prominent return to the Training coaches grid (hash scroll). */
export function CoachProfileBackBar() {
  return (
    <nav aria-label="Back to coaches" className="mb-6 sm:mb-7">
      <Link
        href="/training#coaches"
        className="group flex min-h-[48px] w-full items-center gap-3 rounded-card border border-line bg-overlay px-4 py-3 text-left transition hover:border-line hover:bg-overlay sm:min-h-[44px] sm:w-fit sm:py-2.5"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-overlay-subtle text-ink transition group-hover:border-line group-hover:text-ink"
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
          <span className="block text-caption font-semibold text-muted">
            Training
          </span>
          <span className="mt-0.5 block text-small font-semibold text-ink">
            Back to coaches
          </span>
        </span>
      </Link>
    </nav>
  );
}
