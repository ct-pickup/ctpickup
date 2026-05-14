import type { SupabaseClient } from "@supabase/supabase-js";

const TOURNAMENT_TEAM = "tournament_team" as const;

export function tournamentTeamRoomSlugForCaptainId(captainId: string): string {
  return `tt${String(captainId).replace(/-/g, "")}`;
}

export type TournamentTeamChatRoom = {
  id: string;
  slug: string;
  title: string;
  room_type: string;
  tournament_id: string | null;
};

function teamChatTitle(teamName: string): string {
  const t = String(teamName || "").trim();
  return `${t || "Team"} 🏆`;
}

/** Ensures a private team room exists for this captain/tournament; adds captain as member. */
export async function ensureTournamentTeamRoom(
  admin: SupabaseClient,
  captainId: string,
  tournamentId: string,
  teamName: string,
  captainUserId: string,
): Promise<TournamentTeamChatRoom | null> {
  const slug = tournamentTeamRoomSlugForCaptainId(captainId);
  const title = teamChatTitle(teamName);

  const existing = await admin
    .from("chat_rooms")
    .select("id,slug,title,room_type,tournament_id")
    .eq("room_type", TOURNAMENT_TEAM)
    .eq("tournament_id", tournamentId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing.error) {
    console.error("[tournamentTeamRoom] select chat_rooms:", existing.error);
    return null;
  }

  let row = existing.data as TournamentTeamChatRoom | null;
  if (!row?.id) {
    const ins = await admin
      .from("chat_rooms")
      .insert({
        slug,
        title,
        room_type: TOURNAMENT_TEAM,
        tournament_id: tournamentId,
        announcements_only: false,
        is_active: true,
      })
      .select("id,slug,title,room_type,tournament_id")
      .single();

    if (ins.error) {
      const msg = ins.error.message || "";
      if (/duplicate key|unique constraint|23505/i.test(msg)) {
        const again = await admin
          .from("chat_rooms")
          .select("id,slug,title,room_type,tournament_id")
          .eq("room_type", TOURNAMENT_TEAM)
          .eq("tournament_id", tournamentId)
          .eq("slug", slug)
          .maybeSingle();
        if (again.error) {
          console.error("[tournamentTeamRoom] re-select after duplicate:", again.error);
          return null;
        }
        row = again.data as TournamentTeamChatRoom | null;
      } else {
        console.error("[tournamentTeamRoom] insert chat_rooms:", ins.error);
        return null;
      }
    } else {
      row = ins.data as TournamentTeamChatRoom;
    }
  }

  if (!row?.id) return null;

  const mem = await admin
    .from("chat_room_members")
    .upsert({ room_id: row.id, user_id: captainUserId }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
  if (mem.error) console.error("[tournamentTeamRoom] captain member upsert:", mem.error);

  return row;
}

/** Adds a player to the captain’s tournament team room (invite accept, etc.). */
export async function addUserToTournamentTeamRoom(
  admin: SupabaseClient,
  captainId: string,
  tournamentId: string,
  userId: string,
): Promise<void> {
  const slug = tournamentTeamRoomSlugForCaptainId(captainId);
  const { data: room, error } = await admin
    .from("chat_rooms")
    .select("id")
    .eq("room_type", TOURNAMENT_TEAM)
    .eq("tournament_id", tournamentId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[tournamentTeamRoom] find room for member:", error);
    return;
  }
  const roomId = (room as { id?: string } | null)?.id;
  if (!roomId) return;

  const mem = await admin
    .from("chat_room_members")
    .upsert({ room_id: roomId, user_id: userId }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
  if (mem.error) console.error("[tournamentTeamRoom] member upsert:", mem.error);
}
