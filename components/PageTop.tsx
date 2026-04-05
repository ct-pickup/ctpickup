"use client";

import Link from "next/link";
import { AuthenticatedProfileMenu } from "@/components/layout/AuthenticatedProfileMenu";
import { HistoryBack } from "@/components/layout/HistoryBack";
import { APP_HOME_URL } from "@/lib/siteNav";

/**
 * Compact page chrome for tool/status views. Matches site dark shell + glass pill.
 * Use `flush` when this sits inside a parent that already applies horizontal padding
 * and max-width (e.g. admin `max-w-6xl px-6`) so the bar aligns with content below.
 */
export default function PageTop({
  title,
  hideMenu = false,
  fallbackHref = "/",
  flush = false,
}: {
  title: string;
  hideMenu?: boolean;
  fallbackHref?: string;
  flush?: boolean;
}) {
  return (
    <div
      className={
        flush ? "w-full pt-2" : "mx-auto max-w-5xl px-5 pt-2"
      }
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/6 px-4 py-2.5 backdrop-blur-none sm:px-5 sm:py-3 lg:rounded-full lg:backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-4 text-sm text-white/80">
          <HistoryBack
            fallbackHref={fallbackHref}
            label="Back"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-white/75 transition hover:text-white"
          />

          <Link href={APP_HOME_URL} className="shrink-0 transition hover:text-white">
            Home
          </Link>

          <span className="truncate font-semibold uppercase tracking-[0.18em] text-white">
            {title}
          </span>
        </div>

        {!hideMenu ? <AuthenticatedProfileMenu /> : null}
      </div>
    </div>
  );
}
