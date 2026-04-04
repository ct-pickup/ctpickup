"use client";

import Link from "next/link";

/**
 * Compact page chrome for tool/status views. Matches site dark shell + glass pill.
 */
export default function PageTop({
  title,
  hideMenu = false,
}: {
  title: string;
  hideMenu?: boolean;
}) {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-2">
      <div className="flex items-center justify-between rounded-full border border-white/15 bg-white/6 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-4 text-sm text-white/80">
          <Link href="/" className="transition hover:text-white">
            Home
          </Link>

          <span className="font-semibold uppercase tracking-[0.18em] text-white">
            {title}
          </span>
        </div>

        {!hideMenu ? (
          <button
            type="button"
            aria-label="Open menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10"
          >
            <span className="text-lg leading-none">≡</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
