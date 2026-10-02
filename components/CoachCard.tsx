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
    <div className="w-full max-w-[320px] rounded-card border border-line bg-card p-5 relative">
      <div className="w-full aspect-[3/4] overflow-hidden rounded-card border border-line bg-overlay-subtle">
        {coach.photoSrc ? (
          <img
            src={coach.photoSrc}
            alt={coach.name}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="mt-4 space-y-1">
        <div className="text-body font-semibold text-ink">
          {coach.name}
        </div>

        {coach.experienceLine ? (
          <div className="text-small text-ink">
            <span className="text-ink font-semibold">Experience:</span>{"  "}
            {coach.experienceLine}
          </div>
        ) : null}

        {coach.position ? (
          <div className="text-small text-ink">
            <span className="text-ink font-semibold">Position:</span>{"  "}
            {coach.position}
          </div>
        ) : null}

        {coach.homeField ? (
          <div className="text-small text-ink">
            <span className="text-ink font-semibold">Home field:</span>{"  "}
            {coach.homeField}
          </div>
        ) : null}
      </div>

      <div ref={menuRef} className="mt-4 flex justify-end relative">
        <button
          type="button"
          aria-label="More Info"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-button border border-line bg-overlay-subtle px-3 py-2 text-ink hover:bg-overlay"
        >
          <span className="text-h3 font-serif leading-none">⋯</span>
        </button>

        {menuOpen && (
          <div className="absolute right-0 bottom-full mb-2 w-40 overflow-hidden rounded-card border border-line bg-canvas">
            <Link
              href={href}
              onClick={() => setMenuOpen(false)}
              className="block w-full px-4 py-3 text-left text-small text-ink hover:bg-overlay"
            >
              More Info
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
