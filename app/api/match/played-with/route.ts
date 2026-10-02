import { NextResponse } from "next/server";
import { matchErrorResponse, NO_STORE } from "@/lib/match/matchRoute";
import { MATCH_CONFIG, playedWithForRuns } from "@/lib/match/matchService";
import { requireAuthedUser } from "@/lib/referral/auth";

export const dynamic = "force-dynamic";

/** GET ?run_ids=a,b — per run, players going whom the caller has played with (first name and avatar only). */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const runIds = (new URL(req.url).searchParams.get("run_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (runIds.length > MATCH_CONFIG.playedWithMaxRuns) {
    return NextResponse.json({ error: `At most ${MATCH_CONFIG.playedWithMaxRuns} games per request.` }, { status: 400 });
  }

  try {
    const runs = await playedWithForRuns(auth.admin, auth.user.id, runIds);
    return NextResponse.json({ runs }, { headers: NO_STORE });
  } catch (e) {
    return matchErrorResponse("played-with", e);
  }
}
