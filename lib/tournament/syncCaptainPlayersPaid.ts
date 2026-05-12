import type { SupabaseClient } from "@supabase/supabase-js";

/** Roster seats that count toward squad size (invited + accepted, excluding declined/removed). */
export async function syncCaptainPlayersPaid(admin: SupabaseClient, captainId: string): Promise<void> {
  const { data: rows } = await admin.from("tournament_roster").select("status").eq("captain_id", captainId);
  const rosterPlayers = (rows || []).filter(
    (r: { status: string }) => r.status === "invited" || r.status === "accepted",
  ).length;
  const captainSelf = 1;
  const playersPaid = captainSelf + rosterPlayers;

  await admin.from("tournament_captains").update({ players_paid: playersPaid }).eq("id", captainId);
}
