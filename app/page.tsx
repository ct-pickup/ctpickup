import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { HomeSessionIntro } from "@/components/home/HomeSessionIntro";
import { HomeHeroBrand } from "@/components/home/HomeHeroBrand";
import FirstTimeHomeWelcome from "@/components/home/FirstTimeHomeWelcome";
import { shouldShowFirstRunHomeOnRoot } from "@/lib/profile/resolveFirstRunHome";
import { getAuthUserSafe, trySupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SITE_ORIGIN } from "@/lib/site";

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

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-white"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-white/85"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M17.5 6.5h.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await connection();

  const supabase = await trySupabaseServer();
  if (supabase) {
    const user = await getAuthUserSafe(supabase);
    if (user) {
      const firstRun = await shouldShowFirstRunHomeOnRoot(user, supabase);
      if (firstRun) {
        return <FirstTimeHomeWelcome />;
      }
      redirect("/dashboard");
    }
  }

  return (
    <HomeSessionIntro>
      <main className="overflow-x-hidden py-4 sm:py-5">
        <div className="mx-auto max-w-5xl px-4 sm:px-5">
          <div className="rounded-2xl border border-white/15 bg-white/6 px-4 py-2.5 backdrop-blur-none sm:rounded-full sm:px-5 sm:py-3 sm:backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 sm:gap-4">
              <div className="min-w-0 text-xs font-semibold uppercase leading-snug tracking-[0.14em] text-white/90 sm:text-sm sm:tracking-[0.22em] md:text-base">
                Competitive · Together
              </div>

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 sm:h-11 sm:w-11">
                <UserIcon />
              </div>
            </div>
          </div>
        </div>

        <section className="flex min-h-[56vh] flex-col items-center justify-center px-4 pb-6 pt-4 text-center sm:min-h-[64vh] sm:pb-8 sm:pt-6 md:min-h-[72vh] md:pb-0 md:pt-0">
          <HomeHeroBrand />

          <div className="mt-4 max-w-xl text-pretty text-sm font-medium leading-relaxed text-white/75 sm:mt-5 sm:text-base">
            Find competitive pickup soccer in Connecticut. Join games, see what’s upcoming, and show up ready to play.
          </div>

          <div className="mt-6 flex w-full max-w-sm flex-col items-stretch gap-3 sm:mt-8 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
            <Link
              href="/pickup/upcoming-games"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black sm:min-w-[160px]"
            >
              Join a Pickup
            </Link>

            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 sm:min-w-[160px]"
            >
              Log In
            </Link>
          </div>

          <div className="mt-6 sm:mt-8">
            <a
              href="https://instagram.com/ct.pickup"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-3 rounded-lg px-2 text-sm text-white/80 transition hover:text-white"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10">
                <InstagramIcon />
              </span>
              <span className="font-medium">@ct.pickup</span>
            </a>
          </div>
        </section>
      </main>
    </HomeSessionIntro>
  );
}
