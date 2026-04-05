"use client";

import { useEffect, useState } from "react";
import {
  AuthenticatedProfileMenu,
  PageShell,
  TopNav,
} from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseBrowser } from "@/lib/supabase/client";
import { resolveWelcomeFirstName } from "@/lib/welcomeFirstName";

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

export default function AfterLoginClient() {
  const [welcomeTarget, setWelcomeTarget] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const params = new URLSearchParams(window.location.search);
    const isFirstHubVisitAfterSignup = params.get("new") === "1";

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      const user = data.user;

      if (error || !user) {
        setWelcomeTarget(
          isFirstHubVisitAfterSignup ? "Welcome" : "Welcome back"
        );
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", user.id)
        .maybeSingle();

      const firstName = resolveWelcomeFirstName(profile, user);

      if (isFirstHubVisitAfterSignup) {
        setWelcomeTarget(firstName ? `Welcome, ${firstName}` : "Welcome");
      } else {
        setWelcomeTarget(
          firstName ? `Welcome back, ${firstName}` : "Welcome back"
        );
      }
    })();
  }, []);

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
        window.setTimeout(() => step(nextLen + 1), charDelayMs())
      );
    };

    pending.push(
      window.setTimeout(() => {
        if (cancelled) return;
        step(1);
      }, startPauseMs)
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

  return (
    <PageShell maxWidthClass="max-w-6xl" className="pb-20 pt-2">
      <TopNav
        brandHref={APP_HOME_URL}
        homeHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />

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
          </div>

          <HeroSlideshow />
        </div>
      </div>
    </PageShell>
  );
}
