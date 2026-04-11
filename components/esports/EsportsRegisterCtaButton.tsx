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
import { useEsportsTournamentPaidRegistration } from "@/components/esports/useEsportsTournamentPaidRegistration";

type Props = {
  tournamentId: string;
  className?: string;
  children: ReactNode;
  /** Shown instead of {children} when the user is already paid for this tournament. */
  registeredLabel?: ReactNode;
  /**
   * When set (including `null` while resolving), skips the internal paid check so the parent can
   * fetch once for multiple UI pieces.
   */
  paymentRecorded?: boolean | null;
};

/**
 * Logged-out: signup (first browser visit) or login (returning) with return path to registration.
 * Logged-in: navigate to registration flow.
 */
export function EsportsRegisterCtaButton({
  tournamentId,
  className,
  children,
  registeredLabel = "You're registered",
  paymentRecorded: paymentRecordedProp,
}: Props) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const useInternalPaidLookup = paymentRecordedProp === undefined;
  const hookPaid = useEsportsTournamentPaidRegistration(
    supabase,
    isReady,
    tournamentId,
    authed,
    useInternalPaidLookup,
  );
  const paidForTournament = useInternalPaidLookup ? hookPaid : paymentRecordedProp;

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
    if (paidForTournament === null) {
      return (
        <button type="button" disabled className={className}>
          {children}
        </button>
      );
    }
    if (paidForTournament === true) {
      return (
        <Link
          href={`/esports/tournaments/${tournamentId}`}
          className={className}
        >
          {registeredLabel}
        </Link>
      );
    }
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
