"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { HomeHeroBrand } from "@/components/home/HomeHeroBrand";

/** Bump if you change the intro enough that users should see it again in a new deploy (optional manual bump). */
export const HOME_INTRO_STORAGE_KEY = "ctpickup_home_intro_v1";

/** Time logo + wordmark stay settled before cross-fade to the page. */
export const HOME_INTRO_HOLD_MS = 1150;

/** Cross-fade duration (overlay out, page in). */
export const HOME_INTRO_EXIT_MS = 480;

type Phase = "boot" | "intro" | "exiting" | "done";

export function HomeSessionIntro({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [introReady, setIntroReady] = useState(false);

  useLayoutEffect(() => {
    const seen = sessionStorage.getItem(HOME_INTRO_STORAGE_KEY);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (seen || reduceMotion) {
      if (!seen && reduceMotion) {
        sessionStorage.setItem(HOME_INTRO_STORAGE_KEY, "1");
      }
      setPhase("done");
      return;
    }

    setPhase("intro");
    requestAnimationFrame(() => setIntroReady(true));

    const tExit = window.setTimeout(() => setPhase("exiting"), HOME_INTRO_HOLD_MS);
    const tDone = window.setTimeout(() => {
      sessionStorage.setItem(HOME_INTRO_STORAGE_KEY, "1");
      setPhase("done");
    }, HOME_INTRO_HOLD_MS + HOME_INTRO_EXIT_MS);

    return () => {
      window.clearTimeout(tExit);
      window.clearTimeout(tDone);
    };
  }, []);

  const pageVisible = phase === "done";
  const showOverlay = phase !== "done";
  const overlayFading = phase === "exiting";

  return (
    <div className="relative min-h-screen">
      <div
        className={[
          "transition-[opacity,visibility] ease-out",
          pageVisible
            ? "opacity-100 visible"
            : "opacity-0 invisible pointer-events-none",
        ].join(" ")}
        style={{
          transitionDuration: pageVisible ? `${HOME_INTRO_EXIT_MS}ms` : "0ms",
        }}
        aria-hidden={!pageVisible}
      >
        {children}
      </div>

      {showOverlay ? (
        <div
          className={[
            "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--bg)]",
            "transition-opacity ease-out",
            overlayFading ? "opacity-0 pointer-events-none" : "opacity-100",
          ].join(" ")}
          style={{ transitionDuration: `${HOME_INTRO_EXIT_MS}ms` }}
          aria-hidden
        >
          <div
            className={[
              "flex flex-col items-center will-change-transform",
              "transition-[opacity,transform] duration-[520ms] ease-out",
              introReady
                ? "opacity-100 translate-y-0 scale-100"
                : "opacity-0 translate-y-1 scale-[0.98]",
            ].join(" ")}
          >
            <div
              className={[
                "transition-opacity duration-[480ms] ease-out",
                introReady ? "opacity-100 delay-150" : "opacity-0",
              ].join(" ")}
            >
              <HomeHeroBrand logoAlt="" titleAs="div" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
