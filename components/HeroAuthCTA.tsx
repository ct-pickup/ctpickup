"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function HeroAuthCTA() {
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setIsAuthed(!!data.session);
      setLoading(false);
    }

    run();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) return <div className="mt-7 h-[72px]" />;

  if (isAuthed) {
    return (
      <div className="mt-7 flex flex-col items-center justify-center gap-2">
        <Link
          href="/after-login"
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
