import { NextResponse } from "next/server";

import { bearerToken } from "@/lib/admin/requireAdmin";
import { GAME_LOG_PAGE_SIZE, loadGameLog, pageGameLog, parseGameLogCursor } from "@/lib/records/gameLog";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUESTS_PER_HOUR = 60;

/**
 * GET /api/player/game-log?cursor=
 *
 * The signed-in player's own detailed game log (20 per page, newest first) and, on the first page, insights (win
 * streaks, record with teammates, a year-long rating shape). CT+ is gated in the app only, so this route is safe for
 * any approved member: it returns only the caller's own games, and about other people only the first name and last
 * initial of teammates on the same run. Ratings leave the server only as a direction per game and a 0..1 shape.
 */
export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("approved,is_admin").eq("id", userId).maybeSingle();
  if (!(prof.data?.approved === true || prof.data?.is_admin === true)) {
    return NextResponse.json({ error: "Your account must be approved to see your game log." }, { status: 403 });
  }

  const cursor = parseGameLogCursor(new URL(req.url).searchParams.get("cursor"));
  if (!cursor.ok) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });

  // Its own counter (bucket "player-game-log:<user id>"). Fails open if the store is down.
  const limited = await checkPersistentRateLimit({ route: "player-game-log", ip: userId, limit: REQUESTS_PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  try {
    const { all, insights } = await loadGameLog(admin, userId);
    const page = pageGameLog(all, cursor.offset, GAME_LOG_PAGE_SIZE);
    return NextResponse.json(
      { ok: true, ...page, total: all.length, ...(cursor.offset === 0 ? { insights } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "We could not load your game log right now." }, { status: 500 });
  }
}
