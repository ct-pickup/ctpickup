"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When authed, resolves to whether the user has paid (entry recorded) for this tournament.
 * `null` means still loading or not applicable (not signed in).
 * Set `enabled` false to skip fetching (e.g. when the parent supplies the value).
 */
export function useEsportsTournamentPaidRegistration(
  supabase: SupabaseClient | null,
  isReady: boolean,
  tournamentId: string,
  authed: boolean | null,
  enabled = true,
): boolean | null {
  const [paid, setPaid] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPaid(null);
      return;
    }
    if (!isReady || !supabase || authed !== true) {
      setPaid(null);
      return;
    }

    let alive = true;
    setPaid(null);

    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!alive || !u.user) {
        if (alive) setPaid(false);
        return;
      }
      const { data } = await supabase
        .from("esports_tournament_registrations")
        .select("payment_status")
        .eq("tournament_id", tournamentId)
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (!alive) return;
      setPaid(data?.payment_status === "paid");
    })();

    return () => {
      alive = false;
    };
  }, [supabase, isReady, tournamentId, authed, enabled]);

  return paid;
}
