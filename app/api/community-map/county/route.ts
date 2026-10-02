import { NextResponse } from "next/server";
import {
  COMMUNITY_COUNTIES,
  COMMUNITY_COUNTY_BY_ID,
  countyForZip,
  zipMatchesCountyRanges,
} from "@/lib/communityMap/counties";
import { isLegacyMobileClient, legacyCommunityCountyPayload } from "@/lib/api/appVersion";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENUE_TO_ZIP: Record<string, string> = {
  "Sofive Meadowlands": "07072",
  "Sofive Meadowlands 5v5": "07072",
  "Sofive Meadowlands 7v7": "07072",
  "Sofive Cherry Hill": "08034",
  "Sofive Cherry Hill 5v5": "08034",
  "Sofive Cherry Hill 7v7": "08034",
  "Sofive Brooklyn": "11201",
  "Hudson Sports Complex": "10990",
  "Hudson Sports": "10990",
  "New Rochelle SoccerRoof": "10801",
  "New Rochelle": "10801",
  "Sofive Rockville": "20850",
  "Sofive Columbia": "20901",
  "SoccerDome Jessup": "20794",
  "SoccerDome Harmans": "21201",
  "Baltimore SoccerRoof": "21201",
  "DC SoccerRoof": "20910",
  "New Haven SoccerRoof": "06510",
};

const TOP_RATED_MIN_STAR = 4.5;
const LIST_MIN_STAR = 3.5;

type StarBucket = "5" | "4" | "3" | "2" | "1";

function emptyStarCounts(): Record<StarBucket, number> {
  return { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
}

/** Whole-star bucket; half stars round down, and 0.5 lands in the 1★ bucket. */
function starBucket(star: number): StarBucket {
  return String(Math.min(5, Math.max(1, Math.floor(star)))) as StarBucket;
}

function toStar(v: unknown): number | null {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
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

/** Top-rated player counts per county — used for map circle ★ badges. */
export async function GET(req: Request) {
  const gate = await requireApprovedUser(req);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as { admin: ReturnType<typeof getSupabaseAdmin> };

  const url = new URL(req.url);
  const countyId = url.searchParams.get("county_id")?.trim() ?? "";
  const overview = url.searchParams.get("overview") === "1";

  // TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
  if (isLegacyMobileClient(req)) {
    const legacy = await legacyCommunityCountyPayload(admin, { countyId, overview, resolveCountyId });
    return NextResponse.json(legacy.body, { status: legacy.status });
  }

  if (overview || !countyId) {
    const [{ data: profiles }, { data: ratings }] = await Promise.all([
      admin.from("profiles").select("id,zip_code,nearest_venue").eq("approved", true),
      admin
        .from("player_ratings")
        .select("user_id,star_rating")
        .gte("star_rating", TOP_RATED_MIN_STAR),
    ]);

    const topRatedIds = new Set(
      (ratings ?? []).map((r) => r.user_id as string).filter(Boolean),
    );
    const topRatedByCounty: Record<string, number> = {};
    for (const c of COMMUNITY_COUNTIES) topRatedByCounty[c.id] = 0;

    for (const p of profiles ?? []) {
      if (!topRatedIds.has(p.id as string)) continue;
      // Match circle badge to the top-rated list: ZIP must fall in the county range.
      const fromZip = countyForZip(p.zip_code as string | null);
      if (!fromZip) continue;
      topRatedByCounty[fromZip.id] = (topRatedByCounty[fromZip.id] ?? 0) + 1;
    }

    return NextResponse.json({ ok: true, topRatedByCounty });
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
    admin.from("player_ratings").select("user_id,star_rating,score"),
  ]);

  const ratingByUser = new Map<string, { star: number | null; score: number }>();
  for (const r of ratings ?? []) {
    if (!r.user_id) continue;
    const score = Number(r.score);
    ratingByUser.set(r.user_id as string, {
      star: toStar(r.star_rating),
      score: Number.isFinite(score) ? score : 0,
    });
  }

  const starCounts = emptyStarCounts();
  type TopRatedRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    playing_position: string | null;
  };
  const candidates: Array<{ row: TopRatedRow; star: number; score: number }> = [];

  for (const p of profiles ?? []) {
    const memberCountyId = resolveCountyId(
      p.zip_code as string | null,
      p.nearest_venue as string | null,
    );
    if (memberCountyId !== county.id) continue;

    const rating = ratingByUser.get(p.id as string);
    const star = rating?.star ?? null;
    if (star == null) continue;
    starCounts[starBucket(star)] += 1;

    // Top-rated list: ZIP must fall in this county's ranges (not venue fallback).
    if (star >= LIST_MIN_STAR && zipMatchesCountyRanges(p.zip_code as string | null, county.ranges)) {
      candidates.push({
        row: {
          id: p.id as string,
          first_name: (p.first_name as string | null) ?? null,
          last_name: (p.last_name as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null,
          playing_position: (p.playing_position as string | null) ?? null,
        },
        star,
        score: rating?.score ?? 0,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.star !== b.star) return b.star - a.star;
    if (a.score !== b.score) return b.score - a.score;
    const an = `${a.row.first_name ?? ""} ${a.row.last_name ?? ""}`.trim().toLowerCase();
    const bn = `${b.row.first_name ?? ""} ${b.row.last_name ?? ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });

  return NextResponse.json({
    ok: true,
    county_id: county.id,
    starCounts,
    topRatedPlayers: candidates.slice(0, 10).map((c) => c.row),
  });
}
