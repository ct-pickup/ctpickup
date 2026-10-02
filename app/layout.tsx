import type { Metadata } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "CT Pickup",
  description: "Soccer pickup and tournaments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="bg-canvas font-sans text-body text-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
