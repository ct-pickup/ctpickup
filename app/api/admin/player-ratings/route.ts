import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const VALID_TIERS = new Set(["bronze", "silver", "gold", "platinum", "diamond"]);
const MAX_IDS = 500;

/**
 * Admin-only skill ratings (tier, score, verification, stars).
 * GET ?user_ids=a,b,c or ?tier=diamond
 */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const ids = Array.from(
    new Set(
      (params.get("user_ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_IDS);
  const tier = (params.get("tier") ?? "").trim().toLowerCase();

  if (ids.length === 0 && !tier) {
    return NextResponse.json({ error: "user_ids or tier required" }, { status: 400 });
  }
  if (tier && !VALID_TIERS.has(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  let query = admin
    .from("player_ratings")
    .select("user_id,tier,score,verification,star_rating,star_provisional");
  if (ids.length > 0) query = query.in("user_id", ids);
  if (tier) query = query.eq("tier", tier);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/player-ratings] read failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ratings: data ?? [] });
}
