"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SectionEyebrow } from "@/components/layout";
import { useEsportsTournamentPaidRegistration } from "@/components/esports/useEsportsTournamentPaidRegistration";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Props = {
  tournamentId: string;
  tournamentTitle: string;
};

export function EsportsRegisterPageHeader({ tournamentId, tournamentTitle }: Props) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const paymentRecorded = useEsportsTournamentPaidRegistration(
    supabase,
    isReady,
    tournamentId,
    authed,
  );

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

  const entryComplete = authed === true && paymentRecorded === true;

  return (
    <header className="mt-4">
      <SectionEyebrow>{entryComplete ? "Tournament entry" : "Esports registration"}</SectionEyebrow>
      <h1 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
        {tournamentTitle}
      </h1>
      {entryComplete ? (
        <p className="mt-3 text-sm text-white/60">
          Your entry fee is recorded.{" "}
          <Link
            href={`/esports/tournaments/${tournamentId}`}
            className="text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Tournament overview
          </Link>
        </p>
      ) : (
        <p className="mt-3 text-sm text-white/60">
          Consent, signature, and $10 entry. You must be signed in.{" "}
          <Link
            href={`/esports/tournaments/${tournamentId}`}
            className="text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Tournament overview
          </Link>
        </p>
      )}
    </header>
  );
}
