import { appAsyncStorage } from "@/lib/appAsyncStorage";

/** Device-local memory of which badges this player had already earned the last time the shelf was shown. */
const KEY_PREFIX = "ctpickup_badges_seen_v1:";
const key = (userId: string) => `${KEY_PREFIX}${userId}`;

/** Null when this device has no memory for the player yet. */
export async function readSeenBadges(userId: string): Promise<Set<string> | null> {
  try {
    const raw = await appAsyncStorage.getItem(key(userId));
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return null;
  }
}

export async function writeSeenBadges(userId: string, earnedIds: Iterable<string>): Promise<void> {
  try {
    await appAsyncStorage.setItem(key(userId), JSON.stringify([...earnedIds]));
  } catch {
    /* the unlock may replay next time; harmless */
  }
}
