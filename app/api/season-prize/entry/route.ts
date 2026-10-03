import { NextResponse } from "next/server";

import { isSeasonPrizeEnabled, SEASON_PRIZE_RULES_VERSION, seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "season-prize";
const REQUESTS_PER_HOUR = 30;

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** GET: has the signed-in player entered the current season? Only ever their own entry. */
export async function GET(req: Request) {
  if (!isSeasonPrizeEnabled()) return NOT_FOUND();
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: REQUESTS_PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  const season = seasonWindowFor();
  const { data, error } = await auth.admin
    .from("season_prize_entries")
    .select("accepted_at")
    .eq("user_id", auth.user.id)
    .eq("season_key", season.key)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not check your entry." }, { status: 500 });

  return NextResponse.json({ ok: true, season_key: season.key, entered: data != null }, { headers: { "Cache-Control": "no-store" } });
}

/** POST: record the player's entry for the current season. Idempotent: a second call changes nothing. */
export async function POST(req: Request) {
  if (!isSeasonPrizeEnabled()) return NOT_FOUND();
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: REQUESTS_PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  const season = seasonWindowFor();
  const { error } = await auth.admin
    .from("season_prize_entries")
    .upsert(
      { user_id: auth.user.id, season_key: season.key, rules_version: SEASON_PRIZE_RULES_VERSION },
      { onConflict: "user_id,season_key", ignoreDuplicates: true },
    );
  if (error) {
    console.error(`[api/${ROUTE}] insert failed`, error.message);
    return NextResponse.json({ error: "We couldn't record your entry. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, season_key: season.key, entered: true });
}
