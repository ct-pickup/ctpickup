import { NextResponse } from "next/server";
import { matchErrorResponse, NO_STORE } from "@/lib/match/matchRoute";
import { fillCandidatesForRun, MATCH_CONFIG, requireHostRunAccess } from "@/lib/match/matchService";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimitStrict } from "@/lib/server/persistentRateLimit";

export const dynamic = "force-dynamic";

/**
 * GET ?run_id= — up to 10 suggested players for a game the caller hosts.
 * Rate limited per caller in the shared api_rate_limit_buckets store; fails closed.
 */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const runId = (new URL(req.url).searchParams.get("run_id") ?? "").trim();
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const rl = await checkPersistentRateLimitStrict(auth.admin, {
    bucketKey: `match-fill:${auth.user.id}`,
    limit: MATCH_CONFIG.listRateLimit.limit,
    windowSeconds: MATCH_CONFIG.listRateLimit.windowSeconds,
  });
  if (!rl.ok) {
    if (rl.reason === "limited") {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: "Fill your game is temporarily unavailable." }, { status: 503 });
  }

  try {
    const access = await requireHostRunAccess(auth.admin, runId, auth.user.id);
    const result = await fillCandidatesForRun(auth.admin, access);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    return matchErrorResponse("fill-candidates", e);
  }
}
