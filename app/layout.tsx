"use client";

import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const hideHelp =
    pathname === "/signup" ||
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname === "/help";

  return (
    <html lang="en" className={sora.variable}>
      <body>
        {children}

        {!hideHelp ? (
          <Link
            href="/help"
            className="fixed bottom-5 right-5 z-50 rounded-full border border-white/15 bg-black px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-white/[0.06]"
          >
            💬 Ask AI / Help
          </Link>
        ) : null}
      </body>
    </html>
  );
}
