import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMUNITY_COUNTIES,
  COMMUNITY_COUNTY_BY_ID,
  countyForZip,
  zipMatchesCountyRanges,
} from "@/lib/communityMap/counties";

/**
 * Compatibility with the App Store build v1.3.5, which predates star ratings and never sends x-app-version.
 * Every legacy branch lives in this module so it can be deleted in one go.
 * TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
 * At the same time, drop the legacy player_cards columns (tier, verification, sessions, reliability) by recreating
 * the view from 20261002190000_player_cards_stars.sql, and delete scripts/check-player-cards.mjs.
 */

export const APP_VERSION_HEADER = "x-app-version";

const NATIVE_USER_AGENT = /\b(CFNetwork|Darwin|okhttp)\//i;

/**
 * True for requests from the v1.3.5 app: no x-app-version header, a native networking user agent
 * (iOS CFNetwork/Darwin, Android okhttp) and no browser signals. Web pages and unknown callers get the new response.
 */
export function isLegacyMobileClient(req: Request): boolean {
  const h = req.headers;
  if ((h.get(APP_VERSION_HEADER) ?? "").trim()) return false;
  if (h.has("sec-fetch-mode") || h.has("sec-fetch-site")) return false;
  const ua = h.get("user-agent") ?? "";
  if (/^Mozilla\//i.test(ua)) return false;
  return NATIVE_USER_AGENT.test(ua);
}

// TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
export const LEGACY_TIER_RATING_COLUMNS = "user_id,tier,score,sessions,reliability";

/** v1.3.5 Rankings row fields, computed exactly as before b9c83a1; the old app derives points from tier itself. */
export function legacyTierRowFields(r: {
  tier?: string | null;
  score?: number | null;
  reliability?: number | null;
}): { tier: string; score: number; reliability: number } {
  return {
    tier: (r.tier ?? "bronze").toLowerCase(),
    score: r.score ?? 50,
    reliability: r.reliability ?? 0,
  };
}

// TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
export const LEGACY_PROFILE_RATING_COLUMNS = "sessions,tier,verification";

/**
 * v1.3.5 player profile fields. The old app shows tier and the Verified badge from these. It never reads reliability,
 * so the key stays for shape but is always null, and the profiles.tier fallback (an invite wave label) is not restored.
 */
export function legacyProfileFields(rating: { tier?: string | null; verification?: string | null } | null): {
  tier: string | null;
  verification: string;
  reliability: null;
} {
  return {
    tier: rating?.tier ?? null,
    verification: rating?.verification ?? "self",
    reliability: null,
  };
}

// TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
/** v1.3.5 cannot confirm upcoming games before deleting, so it gets the reason plus a way forward instead of a confirm step. */
export function legacyAccountDeletionMessage(message: string | null, opts: { admin?: boolean } = {}): string {
  const reason = message ?? "This account has upcoming games.";
  const next = opts.admin
    ? "Nothing was deleted. Update CT Pickup to the latest version, or use the website admin, to review and confirm."
    : "Nothing was deleted. Leave those games first, or update CT Pickup to the latest version to review and confirm.";
  return `${reason} ${next}`;
}

type TierKey = "diamond" | "platinum" | "gold" | "silver" | "bronze";

type LegacyCountyMember = {
  id: string;
  zip_code: string | null;
  nearest_venue: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  playing_position?: string | null;
};

// TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
/** v1.3.5 community map payloads (verified diamond badges, tier counts, elite list), as before a5214ae. */
export async function legacyCommunityCountyPayload(
  admin: SupabaseClient,
  opts: {
    countyId: string;
    overview: boolean;
    resolveCountyId: (zip: string | null, venue: string | null) => string | null;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (opts.overview || !opts.countyId) {
    const [{ data: profiles }, { data: ratings }] = await Promise.all([
      admin.from("profiles").select("id,zip_code,nearest_venue").eq("approved", true),
      admin
        .from("player_ratings")
        .select("user_id,tier,verification")
        .eq("tier", "diamond")
        .in("verification", ["document", "vouched"]),
    ]);
    const verifiedDiamondIds = new Set(((ratings ?? []) as { user_id: string }[]).map((r) => r.user_id).filter(Boolean));
    const verifiedDiamondByCounty: Record<string, number> = {};
    for (const c of COMMUNITY_COUNTIES) verifiedDiamondByCounty[c.id] = 0;
    for (const p of (profiles ?? []) as LegacyCountyMember[]) {
      if (!verifiedDiamondIds.has(p.id)) continue;
      const fromZip = countyForZip(p.zip_code);
      if (!fromZip) continue;
      verifiedDiamondByCounty[fromZip.id] = (verifiedDiamondByCounty[fromZip.id] ?? 0) + 1;
    }
    return { status: 200, body: { ok: true, verifiedDiamondByCounty } };
  }

  const county = COMMUNITY_COUNTY_BY_ID[opts.countyId];
  if (!county) return { status: 400, body: { error: "Unknown county_id" } };

  const [{ data: profiles }, { data: ratings }] = await Promise.all([
    admin
      .from("profiles")
      .select("id,zip_code,nearest_venue,first_name,last_name,avatar_url,playing_position")
      .eq("approved", true),
    admin.from("player_ratings").select("user_id,tier,verification"),
  ]);

  const ratingByUser = new Map<string, { tier: string; verification: string }>();
  for (const r of (ratings ?? []) as { user_id: string | null; tier: string | null; verification: string | null }[]) {
    if (!r.user_id) continue;
    ratingByUser.set(r.user_id, {
      tier: String(r.tier ?? "").toLowerCase(),
      verification: String(r.verification ?? "self").toLowerCase(),
    });
  }

  const tierCounts: Record<TierKey, number> = { diamond: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 };
  type EliteRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    playing_position: string | null;
    tier: "diamond" | "platinum";
  };
  const eliteCandidates: EliteRow[] = [];

  for (const p of (profiles ?? []) as LegacyCountyMember[]) {
    if (opts.resolveCountyId(p.zip_code, p.nearest_venue) !== county.id) continue;
    const rating = ratingByUser.get(p.id);
    const tier = (rating?.tier ?? "bronze") as TierKey;
    if (tier in tierCounts) tierCounts[tier] += 1;
    const verified = rating?.verification === "document" || rating?.verification === "vouched";
    const eliteTier = rating?.tier === "diamond" || rating?.tier === "platinum";
    if (verified && eliteTier && zipMatchesCountyRanges(p.zip_code, county.ranges)) {
      eliteCandidates.push({
        id: p.id,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        avatar_url: p.avatar_url ?? null,
        playing_position: p.playing_position ?? null,
        tier: rating!.tier as "diamond" | "platinum",
      });
    }
  }

  eliteCandidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "diamond" ? -1 : 1;
    const an = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().toLowerCase();
    const bn = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });

  return {
    status: 200,
    body: {
      ok: true,
      county_id: county.id,
      tierCounts,
      verifiedDiamondCount: eliteCandidates.filter((e) => e.tier === "diamond").length,
      elitePlayers: eliteCandidates.slice(0, 10),
    },
  };
}
