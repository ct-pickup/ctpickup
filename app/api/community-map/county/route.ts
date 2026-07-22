import { NextResponse } from "next/server";
import {
  COMMUNITY_COUNTIES,
  COMMUNITY_COUNTY_BY_ID,
  countyForZip,
  zipMatchesCountyRanges,
} from "@/lib/communityMap/counties";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENUE_TO_ZIP: Record<string, string> = {
  "Sofive Meadowlands": "07072",
  "Sofive Meadowlands 5v5": "07072",
  "Sofive Meadowlands 7v7": "07072",
  "Sofive Brooklyn": "11201",
  "Hudson Sports Complex": "10990",
  "Hudson Sports": "10990",
  "New Rochelle SoccerRoof": "10801",
  "New Rochelle": "10801",
  "Sofive Rockville": "20850",
  "Sofive Columbia": "21201",
  "SoccerDome Jessup": "20794",
  "SoccerDome Harmans": "21201",
  "Baltimore SoccerRoof": "21201",
  "DC SoccerRoof": "20850",
  "New Haven SoccerRoof": "06510",
};

type TierKey = "diamond" | "platinum" | "gold" | "silver" | "bronze";

function emptyTierCounts(): Record<TierKey, number> {
  return { diamond: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 };
}

function resolveCountyId(
  zipCode: string | null | undefined,
  nearestVenue: string | null | undefined,
): string | null {
  const fromZip = countyForZip(zipCode);
  if (fromZip) return fromZip.id;
  if (nearestVenue == null) return null;
  const key = String(nearestVenue).trim();
  if (!key) return null;
  const zip = VENUE_TO_ZIP[key];
  return zip ? (countyForZip(zip)?.id ?? null) : null;
}

async function requireApprovedUser(req: Request) {
  const admin = getSupabaseAdmin();
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const {
    data: { user },
    error: authErr,
  } = await admin.auth.getUser(token);
  if (authErr || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("approved,is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.approved && !profile?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin, user };
}

/** Verified diamond counts per county — used for map circle ◆ badges. */
export async function GET(req: Request) {
  const gate = await requireApprovedUser(req);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as { admin: ReturnType<typeof getSupabaseAdmin> };

  const url = new URL(req.url);
  const countyId = url.searchParams.get("county_id")?.trim() ?? "";
  const overview = url.searchParams.get("overview") === "1";

  if (overview || !countyId) {
    const [{ data: profiles }, { data: ratings }] = await Promise.all([
      admin.from("profiles").select("id,zip_code,nearest_venue").eq("approved", true),
      admin
        .from("player_ratings")
        .select("user_id,tier,verification")
        .eq("tier", "diamond")
        .in("verification", ["document", "vouched"]),
    ]);

    const verifiedDiamondIds = new Set(
      (ratings ?? []).map((r) => r.user_id as string).filter(Boolean),
    );
    const verifiedDiamondByCounty: Record<string, number> = {};
    for (const c of COMMUNITY_COUNTIES) verifiedDiamondByCounty[c.id] = 0;

    for (const p of profiles ?? []) {
      if (!verifiedDiamondIds.has(p.id as string)) continue;
      // Match circle badge to elite list: ZIP must fall in the county range.
      const fromZip = countyForZip(p.zip_code as string | null);
      if (!fromZip) continue;
      verifiedDiamondByCounty[fromZip.id] = (verifiedDiamondByCounty[fromZip.id] ?? 0) + 1;
    }

    return NextResponse.json({ ok: true, verifiedDiamondByCounty });
  }

  const county = COMMUNITY_COUNTY_BY_ID[countyId];
  if (!county) {
    return NextResponse.json({ error: "Unknown county_id" }, { status: 400 });
  }

  const [{ data: profiles }, { data: ratings }] = await Promise.all([
    admin
      .from("profiles")
      .select("id,zip_code,nearest_venue,first_name,last_name,avatar_url,playing_position")
      .eq("approved", true),
    admin.from("player_ratings").select("user_id,tier,verification"),
  ]);

  const ratingByUser = new Map<
    string,
    { tier: string; verification: string }
  >();
  for (const r of ratings ?? []) {
    if (!r.user_id) continue;
    ratingByUser.set(r.user_id as string, {
      tier: String(r.tier ?? "").toLowerCase(),
      verification: String(r.verification ?? "self").toLowerCase(),
    });
  }

  const tierCounts = emptyTierCounts();
  type EliteRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    playing_position: string | null;
    tier: "diamond" | "platinum";
  };
  const eliteCandidates: EliteRow[] = [];

  for (const p of profiles ?? []) {
    const memberCountyId = resolveCountyId(
      p.zip_code as string | null,
      p.nearest_venue as string | null,
    );
    if (memberCountyId !== county.id) continue;

    const rating = ratingByUser.get(p.id as string);
    const tier = (rating?.tier ?? "bronze") as TierKey;
    if (tier in tierCounts) tierCounts[tier] += 1;

    const verified =
      rating?.verification === "document" || rating?.verification === "vouched";
    const eliteTier = rating?.tier === "diamond" || rating?.tier === "platinum";
    // Elite list: ZIP must fall in this county's ranges (not venue fallback).
    if (
      verified &&
      eliteTier &&
      zipMatchesCountyRanges(p.zip_code as string | null, county.ranges)
    ) {
      eliteCandidates.push({
        id: p.id as string,
        first_name: (p.first_name as string | null) ?? null,
        last_name: (p.last_name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
        playing_position: (p.playing_position as string | null) ?? null,
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

  const elitePlayers = eliteCandidates.slice(0, 10);
  const verifiedDiamondCount = eliteCandidates.filter((e) => e.tier === "diamond").length;

  return NextResponse.json({
    ok: true,
    county_id: county.id,
    tierCounts,
    verifiedDiamondCount,
    elitePlayers,
  });
}
