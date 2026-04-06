"use client";

import type { ReactNode } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";

export function PickupSubpageShell({
  title,
  intro,
  children,
  maxWidthClass = "max-w-3xl",
}: {
  title: string;
  intro: string;
  children: ReactNode;
  /** Wider list layouts (e.g. upcoming games). */
  maxWidthClass?: "max-w-3xl" | "max-w-4xl";
}) {
  return (
    <PageShell className="pb-16 pt-2">
      <TopNav
        fallbackHref="/pickup"
        backLabel="Pickup"
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <EsportsSetupNudgeBar />

      <div className={`mx-auto ${maxWidthClass}`}>
        <SectionEyebrow>Pickup</SectionEyebrow>
        <h1 className="mt-3 text-2xl font-bold uppercase tracking-[0.14em] text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mb-8 mt-4 text-sm text-white/70">{intro}</p>
        {children}
      </div>
    </PageShell>
  );
}

/** Suspense fallback aligned with the same shell (tournament-style chrome). */
export function PickupSubpageLoading({ title }: { title: string }) {
  return (
    <PageShell className="pb-16 pt-2">
      <TopNav
        fallbackHref="/pickup"
        backLabel="Pickup"
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <EsportsSetupNudgeBar />
      <div className="mx-auto max-w-3xl">
        <SectionEyebrow>Pickup</SectionEyebrow>
        <h1 className="mt-3 text-2xl font-bold uppercase tracking-[0.14em] text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-4 text-sm text-white/60">Loading…</p>
      </div>
    </PageShell>
  );
}
