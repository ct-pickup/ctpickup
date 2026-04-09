"use client";

import Link from "next/link";
import { PageShell, TopNav } from "@/components/layout";
import { HomeHeroBrand } from "@/components/home/HomeHeroBrand";
import { signupUrlForIntent } from "@/lib/auth/signupIntent";

export function AfterLoginPublicClient({ loginHref }: { loginHref: string }) {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-20 pt-2">
      <TopNav
        brandHref="/"
        homeHref="/"
        fallbackHref="/"
        rightSlot={
          <Link
            href={loginHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Log in
          </Link>
        }
      />

      <div className="mt-8 text-center md:mt-10">
        <HomeHeroBrand titleAs="div" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight md:text-3xl">
          Your CT Pickup home
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/75 md:text-base">
          After you sign in, pickup games, tournaments, training, and community open from one hub
          at <span className="font-medium text-white/90">ctpickup.net</span>.
        </p>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href={loginHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Log in to continue
          </Link>
        </div>
        <p className="mx-auto mt-8 max-w-md text-pretty text-xs leading-relaxed text-white/50">
          New here? Create an account only when you are joining{" "}
          <Link href={signupUrlForIntent("pickup")} className="font-medium text-white/75 underline-offset-4 hover:underline">
            pickup
          </Link>{" "}
          or{" "}
          <Link href={signupUrlForIntent("tournament")} className="font-medium text-white/75 underline-offset-4 hover:underline">
            tournaments / EA SPORTS FC
          </Link>
          — start from the home page.
        </p>
      </div>
    </PageShell>
  );
}
