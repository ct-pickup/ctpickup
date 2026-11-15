import { NextResponse } from "next/server";
import { findPendingRating, ratingGateActiveFor } from "@/lib/ratings/pendingRating";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/**
 * The game this player still has to rate, for the "Rate your game" cards on Home and the Games tab: { pending: null } or
 * { pending: { run_id, title, kickoff_at, expires_at } }. Null while the require_ratings flag is off for them, for admins, and
 * whenever anything goes wrong. Never returns a score.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await admin.auth.getUser(token);
  const user = data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const none = NextResponse.json({ pending: null }, { headers: { "Cache-Control": "no-store" } });
  if (!(await ratingGateActiveFor(admin, user.id))) return none;
  const pending = await findPendingRating(admin, user.id);
  return NextResponse.json({ pending }, { headers: { "Cache-Control": "no-store" } });
}
