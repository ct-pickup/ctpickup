import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const TIER_RANK: Record<string, number> = {
  bronze: 1, silver: 2, gold: 3, platinum: 4, diamond: 5,
};

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { latitude, longitude, min_tier, radius_miles = 30 } = await req.json() as {
    latitude: number;
    longitude: number;
    min_tier: string;
    radius_miles?: number;
  };

  if (!latitude || !longitude) return NextResponse.json({ error: "latitude and longitude required" }, { status: 400 });

  const minRank = TIER_RANK[min_tier ?? "all"] ?? 0;

  // Get all approved players with ratings
  const { data: ratings } = await admin
    .from("player_ratings")
    .select("user_id, tier")
    .not("tier", "is", null);

  if (!ratings || ratings.length === 0) return NextResponse.json({ ok: true, counts: {}, total: 0 });

  const eligibleIds = ratings
    .filter((r: any) => (TIER_RANK[r.tier] ?? 0) >= minRank)
    .map((r: any) => r.user_id);

  if (eligibleIds.length === 0) return NextResponse.json({ ok: true, counts: {}, total: 0 });

  // Get their locations
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, zip_code")
    .in("id", eligibleIds)
    .eq("approved", true);

  // Get zip coordinates (approximate using a lookup)
  // We'll use the player's nearest_venue or zip to estimate
  const { data: profilesWithVenue } = await admin
    .from("profiles")
    .select("id, latitude, longitude, zip_code")
    .in("id", eligibleIds)
    .eq("approved", true);

  // Count by tier within radius
  const tierCounts: Record<string, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0, diamond: 0 };
  const ratingMap = Object.fromEntries(ratings.map((r: any) => [r.user_id, r.tier]));

  let total = 0;
  for (const p of (profilesWithVenue ?? [])) {
    const pLat = (p as any).latitude;
    const pLon = (p as any).longitude;
    if (!pLat || !pLon) continue;
    const dist = distanceMiles(latitude, longitude, pLat, pLon);
    if (dist <= radius_miles) {
      const tier = ratingMap[p.id];
      if (tier && tierCounts[tier] !== undefined) {
        tierCounts[tier]++;
        total++;
      }
    }
  }

  return NextResponse.json({ ok: true, counts: tierCounts, total, radius_miles });
}
