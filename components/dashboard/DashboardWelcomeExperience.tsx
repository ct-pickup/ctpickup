"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  PageShell,
  TopNav,
} from "@/components/layout";
import { EsportsSetupNudgeBar } from "@/components/profile/EsportsSetupNudgeBar";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { resolveWelcomeFirstName } from "@/lib/welcomeFirstName";

/** After first completed welcome on `/dashboard`, we show “Welcome back” on return visits. */
const DASHBOARD_WELCOME_SEEN_KEY = "ctpickup_dashboard_welcome_seen_v1";

const HERO_IMAGES = [
  "/hero/1.jpg",
  "/hero/2.jpg",
  "/hero/3.jpg",
  "/hero/4.jpg",
  "/hero/6.jpg",
];

const HERO_OBJECT_POSITION: Partial<Record<string, string>> = {
  "/hero/6.jpg": "center top",
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function HeroSlideshow() {
  const slides = [...HERO_IMAGES, ...HERO_IMAGES];

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <div
        className="ct-hero-photo-marquee flex w-max"
        style={{ gap: "16px", padding: "16px" }}
      >
        {slides.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="h-[320px] w-[240px] md:h-[420px] md:w-[320px] shrink-0 overflow-hidden rounded-xl bg-white/5"
          >
            <img
              src={src}
              alt={`CT Pickup photo ${i + 1}`}
              className="h-full w-full object-cover"
              style={
                HERO_OBJECT_POSITION[src]
                  ? { objectPosition: HERO_OBJECT_POSITION[src] }
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export type DashboardWelcomeMode = "dashboard" | "firstVisitHome";

export default function DashboardWelcomeExperience({
  mode,
}: {
  mode: DashboardWelcomeMode;
}) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [welcomeTarget, setWelcomeTarget] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  /** `null` until we read localStorage (dashboard mode only). */
  const [firstVisitToDashboard, setFirstVisitToDashboard] = useState<
    boolean | null
  >(mode === "firstVisitHome" ? true : null);

  useEffect(() => {
    if (mode === "firstVisitHome") return;
    try {
      setFirstVisitToDashboard(
        typeof window !== "undefined" &&
          window.localStorage.getItem(DASHBOARD_WELCOME_SEEN_KEY) !== "1",
      );
    } catch {
      setFirstVisitToDashboard(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!isReady || firstVisitToDashboard === null) return;

    const useFreshWelcome = firstVisitToDashboard;

    if (!supabase) {
      setWelcomeTarget(useFreshWelcome ? "Welcome" : "Welcome back");
      return;
    }

    const client = supabase;

    (async () => {
      const { data, error } = await client.auth.getUser();
      const user = data.user;

      if (error || !user) {
        setWelcomeTarget(useFreshWelcome ? "Welcome" : "Welcome back");
        return;
      }

      const { data: profile } = await client
        .from("profiles")
        .select("first_name")
        .eq("id", user.id)
        .maybeSingle();

      const firstName = resolveWelcomeFirstName(profile, user);

      if (useFreshWelcome) {
        setWelcomeTarget("Welcome");
      } else {
        setWelcomeTarget(
          firstName ? `Welcome back, ${firstName}` : "Welcome back",
        );
      }
    })();
  }, [supabase, isReady, firstVisitToDashboard]);

  useEffect(() => {
    if (welcomeTarget === null) return;

    if (prefersReducedMotion()) {
      setTypedLen(welcomeTarget.length);
      return;
    }

    setTypedLen(0);

    let cancelled = false;
    const pending: number[] = [];

    const charDelayMs = () => 28 + Math.random() * 16;
    const startPauseMs = 90;

    const step = (nextLen: number) => {
      if (cancelled) return;
      setTypedLen(nextLen);
      if (nextLen >= welcomeTarget.length) return;
      pending.push(
        window.setTimeout(() => step(nextLen + 1), charDelayMs()),
      );
    };

    pending.push(
      window.setTimeout(() => {
        if (cancelled) return;
        step(1);
      }, startPauseMs),
    );

    return () => {
      cancelled = true;
      pending.forEach((id) => clearTimeout(id));
    };
  }, [welcomeTarget]);

  const visible =
    welcomeTarget === null ? "" : welcomeTarget.slice(0, typedLen);
  const typingComplete =
    welcomeTarget !== null && typedLen >= welcomeTarget.length;

  useEffect(() => {
    if (!typingComplete || firstVisitToDashboard !== true) return;
    if (mode === "firstVisitHome") {
      (async () => {
        try {
          const token =
            (await supabase?.auth.getSession())?.data.session?.access_token;
          if (!token) return;
          await fetch("/api/profile/mark-dashboard-home-seen", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          try {
            window.localStorage.setItem(DASHBOARD_WELCOME_SEEN_KEY, "1");
          } catch {
            /* ignore */
          }
        } catch {
          /* non-fatal */
        }
      })();
      return;
    }

    try {
      window.localStorage.setItem(DASHBOARD_WELCOME_SEEN_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }, [typingComplete, firstVisitToDashboard, mode, supabase]);

  const brandHref = mode === "firstVisitHome" ? "/" : APP_HOME_URL;
  const homeHref = APP_HOME_URL;

  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-20 pt-2">
      <TopNav
        brandHref={brandHref}
        homeHref={homeHref}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <EsportsSetupNudgeBar />

      <div className="pt-6 md:pt-8">
        <div className="mx-auto max-w-full">
          <div className="text-center">
            <h1 className="min-h-[1.35em] text-2xl md:text-3xl font-semibold tracking-tight">
              {visible}
              {!typingComplete && welcomeTarget !== null ? (
                <span
                  className="inline-block w-[0.4ch] animate-pulse text-white/40"
                  aria-hidden
                >
                  |
                </span>
              ) : null}
            </h1>

            <div className="mt-3 text-sm md:text-base font-semibold text-white/75">
              Use the navigation above to explore pickup games, tournaments, training, and more.
            </div>

            {mode === "firstVisitHome" ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={APP_HOME_URL}
                  className="inline-flex min-h-[44px] min-w-[200px] items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-black hover:opacity-95"
                >
                  Continue to home
                </Link>
              </div>
            ) : null}
          </div>

          <HeroSlideshow />
        </div>
      </div>
    </PageShell>
  );
}
