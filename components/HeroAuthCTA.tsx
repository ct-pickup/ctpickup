"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signupUrlForIntent } from "@/lib/auth/signupIntent";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

export default function HeroAuthCTA() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    if (!isReady) return;

    if (!supabase) {
      setIsAuthed(false);
      setLoading(false);
      return;
    }

    const client = supabase;
    let alive = true;

    async function run() {
      const { data } = await client.auth.getSession();
      if (!alive) return;
      setIsAuthed(!!data.session);
      setLoading(false);
    }

    void run();

    const { data: sub } = client.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, isReady]);

  if (!isReady || loading) return <div className="mt-7 h-[72px]" />;

  if (isAuthed) {
    return (
      <div className="mt-7 flex flex-col items-center justify-center gap-2">
        <Link
          href={APP_HOME_URL}
          className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black"
        >
          CONTINUE
        </Link>
        <div className="text-xs text-white/60">You’re signed in.</div>
      </div>
    );
  }

  return (
    <div className="mt-7 flex flex-col items-center justify-center gap-3">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
        <Link
          href={signupUrlForIntent("pickup")}
          className="rounded-md bg-white px-6 py-3 text-center text-sm font-semibold text-black"
        >
          Join Pickup
        </Link>
        <Link
          href={signupUrlForIntent("tournament")}
          className="rounded-md bg-white px-6 py-3 text-center text-sm font-semibold text-black"
        >
          Join Tournament
        </Link>
      </div>
      <Link
        href="/login"
        className="rounded-md border border-white/20 bg-white/5 px-7 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
      >
        Log in
      </Link>
      <div className="max-w-xs text-center text-xs text-white/60">
        Accounts are for joining pickup or tournaments. Browse the site without signing up.
      </div>
    </div>
  );
}
