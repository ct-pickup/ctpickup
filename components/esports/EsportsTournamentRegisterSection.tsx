"use client";

import { useEffect, useState } from "react";
import { EsportsRegisterCtaButton } from "@/components/esports/EsportsRegisterCtaButton";
import { useEsportsTournamentPaidRegistration } from "@/components/esports/useEsportsTournamentPaidRegistration";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type Props = {
  tournamentId: string;
  buttonClassName: string;
};

export function EsportsTournamentRegisterSection({ tournamentId, buttonClassName }: Props) {
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

  const footnote =
    authed === true && paymentRecorded === true ? null : authed === true ? (
      <p className="mt-3 text-xs text-white/45">
        You will review and sign legal documents before paying the entry fee.
      </p>
    ) : (
      <p className="mt-3 text-xs text-white/45">
        Sign in required. You will review and sign legal documents before paying the entry fee.
      </p>
    );

  return (
    <div className="mt-8 border-t border-white/10 pt-8">
      <EsportsRegisterCtaButton
        tournamentId={tournamentId}
        className={buttonClassName}
        paymentRecorded={paymentRecorded}
      >
        Register for this tournament
      </EsportsRegisterCtaButton>
      {footnote}
    </div>
  );
}
