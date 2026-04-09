"use client";

import Link from "next/link";
import { PageShell, TopNav } from "@/components/layout";
import { HomeHeroBrand } from "@/components/home/HomeHeroBrand";

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
          CT Pickup member hub
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/75 md:text-base">
          The member home at{" "}
          <span className="font-medium text-white/90">ctpickup.net</span> after you sign in.
          Pickup games, tournaments, training, and community — from one place.
        </p>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href={loginHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Log in to continue
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            Create an account
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
