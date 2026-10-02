import Link from "next/link";
import { SupportEmailLink } from "@/components/SupportEmailLink";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas px-4 py-8 pb-24 text-center sm:px-5 sm:py-10">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-caption font-medium text-muted sm:gap-x-6 sm:gap-y-2 md:text-small">
        <Link
          href="/help"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-ink sm:min-h-0 sm:px-0 sm:py-0"
        >
          Help
        </Link>
        <SupportEmailLink className="inline-flex min-h-[44px] items-center px-2 py-1 text-muted underline-offset-4 transition hover:text-ink hover:underline sm:min-h-0 sm:px-0 sm:py-0" />
        <Link
          href="/terms"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-ink sm:min-h-0 sm:px-0 sm:py-0"
        >
          Terms
        </Link>
        <Link
          href="/privacy"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-ink sm:min-h-0 sm:px-0 sm:py-0"
        >
          Privacy
        </Link>
        <Link
          href="/liability-waiver"
          className="inline-flex min-h-[44px] items-center px-2 py-1 transition hover:text-ink sm:min-h-0 sm:px-0 sm:py-0"
        >
          Liability Waiver
        </Link>
      </nav>
      <p className="mt-4 text-caption text-muted">
        © {new Date().getFullYear()} CT Pickup
      </p>
    </footer>
  );
}
