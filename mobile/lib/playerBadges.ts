import { siteOrigin } from "@/lib/env";
import { BADGES, type BadgeDef, type BadgeId } from "@shared/badges";

export type ProfileBadge = BadgeDef & { earned: boolean };

/** The catalog with nothing earned, shown until /api/player/badges answers. */
export function unearnedBadges(): ProfileBadge[] {
  return BADGES.map((b) => ({ ...b, earned: false }));
}

/** The caller's badges in catalog order, or null when the server is unreachable. */
export async function fetchMyBadges(accessToken: string): Promise<ProfileBadge[] | null> {
  const origin = siteOrigin();
  if (!origin) return null;
  try {
    const r = await fetch(`${origin}/api/player/badges`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; badges?: Array<{ id: BadgeId; earned: boolean }> } | null;
    if (!r.ok || j?.ok !== true || !Array.isArray(j.badges)) return null;
    const earned = new Map(j.badges.map((b) => [b.id, b.earned === true]));
    return BADGES.map((b) => ({ ...b, earned: earned.get(b.id) ?? false }));
  } catch {
    return null;
  }
}
