"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 12a4.2 4.2 0 1 0-4.2-4.2A4.2 4.2 0 0 0 12 12Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M4.5 20.2c1.8-3.8 5.1-5.2 7.5-5.2s5.7 1.4 7.5 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AccountMenu() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isReady) return;

    if (!supabase) {
      setAuthed(false);
      return;
    }

    void (async () => {
      const { data } = await supabase.auth.getUser();
      setAuthed(!!data.user);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user);
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase, isReady]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const tooltip = authed ? "Account" : "Log in";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="ct-iconbtn"
        title={tooltip}
        aria-label={tooltip}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <PersonIcon />
      </button>

      {open ? (
        <div
          className="ct-card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            width: 210,
            padding: 10,
            zIndex: 60,
          }}
        >
          {!isReady || authed === null ? (
            <div className="text-sm text-white/60">Loading…</div>
          ) : authed ? (
            <div style={{ display: "grid", gap: 8 }}>
              <a className="ct-btn ct-btn-outline" href="/onboarding">
                Player Profile
              </a>
              <a className="ct-btn ct-btn-outline" href="/tournament">
                My submissions
              </a>
              <button className="ct-btn ct-btn-outline" onClick={logout} type="button">
                Log out
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <a className="ct-btn ct-btn-outline" href="/login">
                Log in
              </a>
              <a className="ct-btn ct-btn-outline" href="/login">
                Sign up
              </a>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
