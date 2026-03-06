"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function HeroAuthCTA() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setLoggedIn(!!data.session);
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (!ready) return null;

  // If logged in, remove login/signup buttons (your request).
  if (loggedIn) {
    return (
      <div className="mt-7 flex flex-col items-center justify-center gap-2">
        <div className="text-xs text-white/60">You’re logged in.</div>
        <Link
          href="/status"
          className="text-xs text-white/70 hover:text-white hover:underline underline-offset-4"
        >
          View status
        </Link>
      </div>
    );
  }

  // If not logged in, show CTAs.
  return (
    <div className="mt-7 flex flex-col items-center justify-center gap-2">
      <Link
        href="/login"
        className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black"
      >
        LOG IN
      </Link>

      <div className="text-xs text-white/60">
        You are required to save your info to access invite-only run details and tournaments.
      </div>

      <Link
        href="/signup"
        className="text-xs underline text-white/70 hover:text-white"
      >
        New? Create account
      </Link>
    </div>
  );
}
