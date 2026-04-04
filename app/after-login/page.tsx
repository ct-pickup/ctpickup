"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { TopNav } from "@/components/layout";

const HERO_IMAGES = [
  "/hero/1.jpg",
  "/hero/2.jpg",
  "/hero/3.jpg",
  "/hero/4.jpg",
  "/hero/5.jpg",
  "/hero/6.jpg",
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function HeroSlideshow() {
  const slides = [...HERO_IMAGES, ...HERO_IMAGES];

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <div
        className="flex w-max animate-[slide_40s_linear_infinite]"
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AfterLoginPage() {
  const [heading, setHeading] = useState("WELCOME BACK");
  const [profileName, setProfileName] = useState("Profile");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isNew = params.get("new") === "1";
    const baseWelcome = isNew ? "WELCOME" : "WELCOME BACK";

    setHeading(baseWelcome);

    (async () => {
      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes.session?.user;

      if (!user) {
        setHeading(baseWelcome);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", user.id)
        .maybeSingle();

      const name = String(profile?.first_name || "").trim();

      if (name) {
        setProfileName(name);
        setHeading(`${baseWelcome}, ${name.toUpperCase()}`);
      } else {
        setHeading(baseWelcome);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-[#0f0f10] text-white">
      <style jsx global>{`
        @keyframes slide {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>

      <div className="mx-auto max-w-6xl px-6 pt-6">
        <TopNav
          brandHref="/after-login"
          showBack={false}
          profileSection={{ displayName: profileName }}
        />
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-8 pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h1 className="text-2xl md:text-3xl font-semibold uppercase tracking-tight">
              {heading}
            </h1>

            <div className="mt-3 text-sm md:text-base font-semibold text-white/75">
              Use the navigation above to explore pickup games, tournaments, training, and more.
            </div>
          </div>

          <HeroSlideshow />
        </div>
      </div>
    </main>
  );
}
