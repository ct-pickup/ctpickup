"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type Coach = {
  slug: string;
  name: string;
  photoSrc?: string;
  experienceLine?: string;
  position?: string;
  homeField?: string;
};

export default function CoachCard({ coach }: { coach: Coach }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuOpen) return;
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const href = "/training/coaches/" + encodeURIComponent(coach.slug);

  return (
    <div className="w-full max-w-[320px] rounded-2xl border border-white/10 bg-white/[0.03] p-5 relative">
      <div className="w-full aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {coach.photoSrc ? (
          <img
            src={coach.photoSrc}
            alt={coach.name}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="mt-4 space-y-1">
        <div className="text-base font-semibold uppercase tracking-wide text-white/90">
          {coach.name}
        </div>

        {coach.experienceLine ? (
          <div className="text-sm text-white/80">
            <span className="text-white/85 font-semibold">Experience:</span>{" "}
            {coach.experienceLine}
          </div>
        ) : null}

        {coach.position ? (
          <div className="text-sm text-white/80">
            <span className="text-white/85 font-semibold">Position:</span>{" "}
            {coach.position}
          </div>
        ) : null}

        {coach.homeField ? (
          <div className="text-sm text-white/80">
            <span className="text-white/85 font-semibold">Home field:</span>{" "}
            {coach.homeField}
          </div>
        ) : null}
      </div>

      <div ref={menuRef} className="mt-4 flex justify-end relative">
        <button
          type="button"
          aria-label="More Info"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white/85 hover:bg-white/[0.06]"
        >
          <span className="text-lg leading-none">⋯</span>
        </button>

        {menuOpen && (
          <div className="absolute right-0 bottom-full mb-2 w-40 overflow-hidden rounded-xl border border-white/10 bg-black shadow-lg">
            <Link
              href={href}
              onClick={() => setMenuOpen(false)}
              className="block w-full px-4 py-3 text-left text-sm text-white/85 hover:bg-white/[0.06]"
            >
              More Info
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
