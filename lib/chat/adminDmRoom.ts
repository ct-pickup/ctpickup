import { createHash } from "crypto";

/** Stable slug for a 1:1 admin↔player DM implemented as a `group` room (unique on `chat_rooms.slug`). */
export function adminDmRoomSlug(userIdA: string, userIdB: string): string {
  const a = userIdA.toLowerCase();
  const b = userIdB.toLowerCase();
  const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
  const h = createHash("sha256").update(pair).digest("hex").slice(0, 32);
  return `dm${h}`;
}

const DM_GROUP_SLUG_RE = /^dm[a-f0-9]{32}$/i;

export function isAdminDmGroupSlug(slug: string): boolean {
  return DM_GROUP_SLUG_RE.test(String(slug || "").trim());
}
