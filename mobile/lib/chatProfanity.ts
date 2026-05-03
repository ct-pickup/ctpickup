import { Filter } from "bad-words";

/** Same word source as `badwords-list` (seeded in migration `20260503180000_chat_profanity_and_room_admin.sql`). */
const filter = new Filter();

export const CHAT_PROFANITY_USER_MESSAGE = "Profanity isn’t allowed in chat.";

export function messageContainsProfanity(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  return filter.isProfane(s);
}
