"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  readHasEverSignedUpBrowser,
} from "@/lib/auth/signupIntent";
import {
  loginUrlForEsportsRegister,
  signupUrlForEsportsRegister,
} from "@/lib/auth/esportsRegisterUrls";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Props = {
  tournamentId: string;
  className?: string;
  children: ReactNode;
};

/**
 * Logged-out: signup (first browser visit) or login (returning) with return path to registration.
 * Logged-in: navigate to registration flow.
 */
export function EsportsRegisterCtaButton({ tournamentId, className, children }: Props) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isReady || !supabase) {
      if (isReady && !supabase) setAuthed(false);
      return;
    }
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, isReady]);

  const onClick = useCallback(() => {
    if (authed === true) {
      router.push(`/esports/tournaments/${tournamentId}/register`);
      return;
    }
    const firstVisit = !readHasEverSignedUpBrowser();
    const href = firstVisit
      ? signupUrlForEsportsRegister(tournamentId)
      : loginUrlForEsportsRegister(tournamentId);
    router.push(href);
  }, [authed, router, tournamentId]);

  if (authed === null) {
    return (
      <button type="button" disabled className={className}>
        {children}
      </button>
    );
  }

  if (authed === true) {
    return (
      <Link
        href={`/esports/tournaments/${tournamentId}/register`}
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => onClick()} className={className}>
      {children}
    </button>
  );
}
