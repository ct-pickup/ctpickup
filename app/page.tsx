import type { Metadata } from "next";
import { connection } from "next/server";
import { HomeSessionIntro } from "@/components/home/HomeSessionIntro";
import { SITE_ORIGIN } from "@/lib/site";
import DashboardWelcomeExperience from "@/components/dashboard/DashboardWelcomeExperience";

const canonical = `${SITE_ORIGIN}/`;

export const metadata: Metadata = {
  title: "CT Pickup | Connecticut competitive pickup soccer — ctpickup.net",
  description:
    "CT Pickup at ctpickup.net — competitive pickup soccer in Connecticut. Join games, see what’s upcoming, and connect with the community.",
  alternates: { canonical },
  openGraph: {
    title: "CT Pickup | Connecticut competitive pickup soccer",
    description:
      "Find competitive pickup soccer in Connecticut. Join games and see what’s upcoming at ctpickup.net.",
    url: canonical,
    siteName: "CT Pickup",
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
