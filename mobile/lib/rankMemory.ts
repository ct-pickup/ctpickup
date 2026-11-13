import { appAsyncStorage } from "@/lib/appAsyncStorage";

/** Device-local memory of the Stars ranks this viewer last saw, so the list can show rank-change arrows without a server. */
const KEY_PREFIX = "ctpickup_stars_ranks_v1:";
const key = (viewerId: string) => `${KEY_PREFIX}${viewerId}`;

export async function readRankMemory(viewerId: string): Promise<Record<string, number> | null> {
  try {
    const raw = await appAsyncStorage.getItem(key(viewerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, number> = {};
    for (const [id, rank] of Object.entries(parsed as Record<string, unknown>)) if (typeof rank === "number") out[id] = rank;
    return out;
  } catch {
    return null;
  }
}

export async function writeRankMemory(viewerId: string, snapshot: Record<string, number>): Promise<void> {
  try {
    await appAsyncStorage.setItem(key(viewerId), JSON.stringify(snapshot));
  } catch {
    /* arrows just will not show next time */
  }
}
