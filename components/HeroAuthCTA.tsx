"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    <div className="mt-7 flex flex-col items-center justify-center gap-2">
      <Link
        href="/login"
        className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black"
      >
        LOG IN
      </Link>

      <div className="text-xs text-white/60">
        Required to save your info and access invite-only run details.
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
