import Link from "next/link";
import { SupportEmailLink } from "@/components/SupportEmailLink";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#0f0f10] px-4 py-8 pb-24 text-center sm:px-5 sm:py-10">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-medium text-white/50 sm:gap-x-6 sm:gap-y-2 md:text-sm">
        <Link
          href="/help"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-white/80 sm:min-h-0 sm:px-0 sm:py-0"
        >
          Help
        </Link>
        <SupportEmailLink className="inline-flex min-h-[44px] items-center px-2 py-1 text-white/50 underline-offset-4 transition hover:text-white/80 hover:underline sm:min-h-0 sm:px-0 sm:py-0" />
        <Link
          href="/terms"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-white/80 sm:min-h-0 sm:px-0 sm:py-0"
        >
          Terms
        </Link>
        <Link
          href="/privacy"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-white/80 sm:min-h-0 sm:px-0 sm:py-0"
        >
          Privacy
        </Link>
        <Link
          href="/liability-waiver"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-white/80 sm:min-h-0 sm:px-0 sm:py-0"
        >
          Liability Waiver
        </Link>
      </nav>
      <p className="mt-4 text-[11px] text-white/35">
        © {new Date().getFullYear()} CT Pickup
      </p>
    </footer>
  );
}
