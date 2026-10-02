"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const hideHelp = pathname === "/" || pathname === "/login" || pathname === "/signup";

  return (
    <>
      {children}
      <SiteFooter />
      {!hideHelp ? (
        <Link
          href="/help"
          className="fixed bottom-4 right-4 z-40 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pill border border-line bg-pitch px-4 py-2.5 text-small font-semibold text-on-pitch sm:bottom-5 sm:right-5 sm:min-h-0 sm:min-w-0 sm:py-3"
        >
          Help
        </Link>
      ) : null}
    </>
  );
}
