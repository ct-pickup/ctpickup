import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#0f0f10] px-5 py-10 pb-24 text-center">
      <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-white/50 md:text-sm">
        <Link href="/terms" className="transition hover:text-white/80">
          Terms
        </Link>
        <Link href="/privacy" className="transition hover:text-white/80">
          Privacy
        </Link>
        <Link href="/liability-waiver" className="transition hover:text-white/80">
          Liability Waiver
        </Link>
      </nav>
      <p className="mt-4 text-[11px] text-white/35">
        © {new Date().getFullYear()} CT Pickup
      </p>
    </footer>
  );
}
