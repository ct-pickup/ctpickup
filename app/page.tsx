import type { Metadata } from "next";
import { connection } from "next/server";
import { HomeSessionIntro } from "@/components/home/HomeSessionIntro";
import { SITE_ORIGIN } from "@/lib/site";
import DashboardWelcomeExperience from "@/components/dashboard/DashboardWelcomeExperience";

const canonical = `${SITE_ORIGIN}/`;

export const metadata: Metadata = {
  title: "Competitive Together | Pickup soccer and tournaments — ctpickup.net",
  description:
    "Competitive Together at ctpickup.net — competitive pickup soccer. Join games, see what’s upcoming, and connect with the community.",
  alternates: { canonical },
  openGraph: {
    title: "Competitive Together | Pickup soccer and tournaments",
    description:
      "Find competitive pickup soccer near you. Join games and see what’s upcoming at ctpickup.net.",
    url: canonical,
    siteName: "Competitive Together",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await connection();

  return (
    <HomeSessionIntro>
      <DashboardWelcomeExperience />
    </HomeSessionIntro>
  );
}
