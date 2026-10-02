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
            className="inline-flex min-h-[44px] items-center justify-center rounded-button border border-line bg-overlay-subtle px-4 py-2 text-small font-semibold text-ink hover:bg-overlay"
          >
            Log in
          </Link>
        }
      />

      <div className="mt-8 text-center md:mt-10">
        <HomeHeroBrand titleAs="div" />
        <h1 className="mt-6 text-h2 font-serif font-semibold md:text-h1">
          Your CT Pickup home
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-small leading-relaxed text-muted md:text-body">
          After you sign in, pickup games, tournaments, training, and community open from one hub
          at <span className="font-medium text-ink">ctpickup.net</span>.
        </p>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href={loginHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-pitch px-6 py-3 text-small font-semibold text-on-pitch"
          >
            Log in to continue
          </Link>
        </div>
        <p className="mx-auto mt-8 max-w-md text-pretty text-caption leading-relaxed text-muted">
          New here? Create an account only when you are joining{"  "}
          <Link href={signupUrlForIntent("pickup")} className="font-medium text-muted underline-offset-4 hover:underline">
            pickup
          </Link>{"  "}
          or{"  "}
          <Link href={signupUrlForIntent("tournament")} className="font-medium text-muted underline-offset-4 hover:underline">
            tournaments / EA SPORTS FC
          </Link>
          — start from the home page.
        </p>
      </div>
    </PageShell>
  );
}
