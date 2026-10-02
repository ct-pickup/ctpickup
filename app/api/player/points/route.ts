import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/admin/requireAdmin";
import { ratingPoints } from "@/lib/ratings/points";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/** GET: the caller's leaderboard points and rated sessions. Never tier or score. */
export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await admin
    .from("player_ratings")
    .select("tier,sessions")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[player/points] player_ratings read failed:", error.message);
    return NextResponse.json({ error: "Could not load points." }, { status: 500 });
  }

  const row = data as { tier: string | null; sessions: number | null } | null;
  const sessions = Math.max(0, Math.trunc(Number(row?.sessions ?? 0)) || 0);
  return NextResponse.json({ ok: true, rated: row != null, sessions, points: ratingPoints(row?.tier, sessions) });
}
