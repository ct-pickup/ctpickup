import { NextResponse } from "next/server";

import { requireFlag } from "@/lib/flags";
import { askHostToRepeat, playAgainInfo } from "@/lib/pickup/playAgain";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET ?run_id=  What "Play with this group again" offers this player for a finished game.
 *   role "host": can set up the next game; prefill is the same field, size, price and level one week later.
 *   role "attendee": can ask the host.
 * Behind the 'play_again' flag.
 */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "play_again", auth.user.id);
  if (off) return off;
  const runId = (new URL(req.url).searchParams.get("run_id") ?? "").trim();
  if (!UUID.test(runId)) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  const info = await playAgainInfo(auth.admin, runId, auth.user.id);
  if (!info) return NextResponse.json({ error: "Game not found." }, { status: 404 });
  return NextResponse.json({ ok: true, ...info });
}

/** POST { run_id }  A player from the game asks the host to run it again. */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "play_again", auth.user.id);
  if (off) return off;
  const limited = await checkPersistentRateLimit({ route: "play-again-ask", ip: auth.user.id, limit: 20, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);
  const body = (await req.json().catch(() => null)) as { run_id?: unknown } | null;
  const runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
  if (!UUID.test(runId)) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  const r = await askHostToRepeat(auth.admin, runId, auth.user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, notified: r.notified });
}
