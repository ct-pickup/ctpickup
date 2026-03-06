"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={open ? "rotate-180 transition-transform" : "transition-transform"}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function SideMenu() {
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function closeAll() {
    setOpen(false);
    setStatusOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md px-3 py-2 text-black hover:bg-black/5"
        aria-label="Open menu"
      >
        <HamburgerIcon />
      </button>

      <div
        className={[
          "fixed inset-0 z-40 bg-black/60 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        onClick={closeAll}
        aria-hidden="true"
      />

      <aside
        className={[
          "fixed right-0 top-0 z-50 h-full w-[340px] max-w-[85vw] border-l border-white/10 bg-black text-white",
          "transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">Menu</div>
          <button type="button" onClick={closeAll} className="text-sm underline text-white/70">
            Close
          </button>
        </div>

        <nav className="p-6 space-y-2">
          <Link
            href="/info"
            onClick={closeAll}
            className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5"
          >
            Info
          </Link>

          <Link href="/pickup" onClick={closeAll} className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5">
            Pickup
          </Link>

          <Link href="/tournament" onClick={closeAll} className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5">
            Tournament
          </Link>

          <Link href="/training" onClick={closeAll} className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5">
            Training
          </Link>

          <Link href="/u23" onClick={closeAll} className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5">
            U23 Select Team
          </Link>

          <Link href="/help" onClick={closeAll} className="block rounded-md px-3 py-2 text-white/85 hover:bg-white/5">
            Help
          </Link>

          <button
            type="button"
            onClick={() => setStatusOpen((v) => !v)}
            className="w-full flex items-center justify-between rounded-md px-3 py-2 text-white/85 hover:bg-white/5"
          >
            <span>Status</span>
            <span className="text-white/70">
              <Chevron open={statusOpen} />
            </span>
          </button>

          {statusOpen && (
            <div className="ml-6 mt-1 space-y-1 border-l border-white/10 pl-4">
              <Link
                href="/status/pickup"
                onClick={closeAll}
                className="block rounded-md px-3 py-2 text-white/80 hover:bg-white/5"
              >
                Pickup
              </Link>
              <Link
                href="/status/tournament"
                onClick={closeAll}
                className="block rounded-md px-3 py-2 text-white/80 hover:bg-white/5"
              >
                Tournament
              </Link>
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
