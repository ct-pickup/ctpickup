"use client";

import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sora } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const hideHelp =
    pathname === "/" || pathname === "/login" || pathname === "/signup";

  return (
    <html lang="en" className={sora.variable}>
      <body>
        {children}

        <SiteFooter />

        {!hideHelp ? (
          <Link
            href="/help"
            className="fixed bottom-4 right-4 z-40 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/15 bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-white/[0.06] sm:bottom-5 sm:right-5 sm:min-h-0 sm:min-w-0 sm:py-3"
          >
            Help
          </Link>
        ) : null}
      </body>
    </html>
  );
}
