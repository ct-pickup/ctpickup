import type { Metadata } from "next";
import { Archivo, Instrument_Serif, Inter } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { PRODUCT_NAME } from "@/lib/brand";
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

const archivo = Archivo({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-brand",
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Soccer pickup and tournaments",
  applicationName: PRODUCT_NAME,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable} ${archivo.variable}`}>
      <body className="bg-canvas font-sans text-body text-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
