"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const HERO_IMAGES = [
  "/hero/1.jpg",
  "/hero/2.jpg",
  "/hero/3.jpg",
  "/hero/4.jpg",
  "/hero/5.jpg",
  "/hero/6.jpg",
];

type NavMenu = "pickup" | "tournaments" | "about" | null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-black/60"
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

function DropdownGroup({
  label,
  open,
  onClick,
  items,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  items: { label: string; href: string }[];
}) {
  return (
    <div className="relative">
      <button type="button" onClick={onClick} className="text-sm font-medium">
        {label}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 min-w-[220px] rounded-xl border border-black/10 bg-white p-2 text-black shadow-lg">
          <div className="flex flex-col">
            {items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm hover:bg-black/5"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileDropdownGroup({
  label,
  open,
  onClick,
  items,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  items: { label: string; href: string }[];
}) {
  return (
    <div className="rounded-xl border border-black/10">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        <span>{label}</span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="border-t border-black/10 px-2 py-2">
          <div className="flex flex-col">
            {items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm hover:bg-black/5"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AfterLoginPage() {
  const [openMenu, setOpenMenu] = useState<NavMenu>(null);
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

  const pickupItems = [
    { label: "Upcoming Games", href: "/pickup" },
    { label: "How It Works", href: "/pickup" },
    { label: "Join a Game", href: "/pickup" },
  ];

  const tournamentItems = [
    { label: "Upcoming Tournaments", href: "/tournament" },
    { label: "How It Works", href: "/tournament" },
    { label: "Join a Tournament", href: "/tournament" },
  ];

  const aboutItems = [
    { label: "Mission", href: "/mission" },
    { label: "Rules", href: "/rules" },
    { label: "Community", href: "/community" },
  ];

  function toggleMenu(menu: Exclude<NavMenu, null>) {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  return (
    <main className="min-h-screen bg-black text-white">
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
        <div className="rounded-[28px] bg-white/90 px-6 py-3 text-black">
          <div className="hidden md:flex items-center justify-between gap-4">
            <div className="text-base md:text-lg font-semibold tracking-wide whitespace-nowrap">
              CT Pickup
            </div>

            <div className="flex items-center gap-6">
              <Link href="/" className="text-sm font-medium">
                Home
              </Link>

              <DropdownGroup
                label="Pickup Games"
                open={openMenu === "pickup"}
                onClick={() => toggleMenu("pickup")}
                items={pickupItems}
              />

              <DropdownGroup
                label="Tournaments"
                open={openMenu === "tournaments"}
                onClick={() => toggleMenu("tournaments")}
                items={tournamentItems}
              />

              <Link href="/training" className="text-sm font-medium">
                Training
              </Link>

              <Link href="/u23" className="text-sm font-medium">
                U23
              </Link>

              <DropdownGroup
                label="About"
                open={openMenu === "about"}
                onClick={() => toggleMenu("about")}
                items={aboutItems}
              />
            </div>

            <div className="flex items-center gap-2 rounded-full border border-black/15 px-3 py-1.5">
              <div className="h-8 w-8 rounded-full border border-black/15 flex items-center justify-center">
                <UserIcon />
              </div>
              <div className="text-sm font-medium max-w-[140px] truncate">
                {profileName}
              </div>
            </div>
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-base font-semibold tracking-wide whitespace-nowrap">
                CT Pickup
              </div>

              <div className="flex items-center gap-2 rounded-full border border-black/15 px-3 py-1.5">
                <div className="h-8 w-8 rounded-full border border-black/15 flex items-center justify-center">
                  <UserIcon />
                </div>
                <div className="text-sm font-medium max-w-[120px] truncate">
                  {profileName}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Link href="/" className="rounded-xl border border-black/10 px-4 py-3 text-sm font-medium">
                Home
              </Link>

              <MobileDropdownGroup
                label="Pickup Games"
                open={openMenu === "pickup"}
                onClick={() => toggleMenu("pickup")}
                items={pickupItems}
              />

              <MobileDropdownGroup
                label="Tournaments"
                open={openMenu === "tournaments"}
                onClick={() => toggleMenu("tournaments")}
                items={tournamentItems}
              />

              <Link href="/training" className="rounded-xl border border-black/10 px-4 py-3 text-sm font-medium">
                Training
              </Link>

              <Link href="/u23" className="rounded-xl border border-black/10 px-4 py-3 text-sm font-medium">
                U23
              </Link>

              <MobileDropdownGroup
                label="About"
                open={openMenu === "about"}
                onClick={() => toggleMenu("about")}
                items={aboutItems}
              />
            </div>
          </div>
        </div>
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
