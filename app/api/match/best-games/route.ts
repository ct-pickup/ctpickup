import { NextResponse } from "next/server";
import { matchErrorResponse, NO_STORE } from "@/lib/match/matchRoute";
import { bestGamesForUser, MATCH_CONFIG } from "@/lib/match/matchService";
import { requireAuthedUser } from "@/lib/referral/auth";

export const dynamic = "force-dynamic";

/** GET — top upcoming open games for the caller with up to two reasons each. Never includes the score. */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MATCH_CONFIG.bestGamesMax) : MATCH_CONFIG.bestGamesDefault;

  try {
    const games = await bestGamesForUser(auth.admin, auth.user.id, limit);
    return NextResponse.json({ games }, { headers: NO_STORE });
  } catch (e) {
    return matchErrorResponse("best-games", e);
  }
}
