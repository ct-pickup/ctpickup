/** Matches `chat_rooms.slug` seeded in migration `20260502160000_team_chat.sql`. */
export const TEAM_CHAT_SLUG = "team" as const;
export const ANNOUNCEMENTS_CHAT_SLUG = "announcements" as const;

export type ChatMessageRow = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  sender_display_name: string;
  created_at: string;
};
