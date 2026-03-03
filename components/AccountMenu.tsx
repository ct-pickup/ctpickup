"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function KeyIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10.5 13.5a5.5 5.5 0 1 1 3.89-9.39A5.5 5.5 0 0 1 10.5 13.5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M14.4 9.6 22 17.2v2.3h-2.3l-1.4-1.4-1.4 1.4h-2.3v-2.3l-1.9-1.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setAuthed(!!data.user);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  // Tooltip text per your spec
  const tooltip = authed ? "Account" : "Log in";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="ct-btn ct-btn-outline"
        style={{ padding: "10px 12px", display: "inline-flex", alignItems: "center", gap: 8 }}
        title={tooltip}
        aria-label={tooltip}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <KeyIcon />
      </button>

      {open ? (
        <div
          className="ct-card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            width: 200,
            padding: 10,
            zIndex: 50,
          }}
        >
          {authed ? (
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
