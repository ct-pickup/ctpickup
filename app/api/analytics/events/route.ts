import { NextResponse } from "next/server";

import { clientEventsAllowed, recordEvents } from "@/lib/analytics/events";
import { parseClientBatch, withRegions } from "@/lib/analytics/ingest";
import { requireFlag } from "@/lib/flags";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "analytics-events";

/**
 * POST /api/analytics/events  { session_id, platform, app_version, events: [{ id, name, at, properties }] }
 * First-party usage events from the app. Behind the 'analytics_client' flag. Players who switched usage data off get a quiet 204
 * and nothing is stored. Only the client event names are accepted; anything else in the batch is dropped.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "analytics_client", auth.user.id);
  if (off) return off;

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: 60, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  if (!(await clientEventsAllowed(auth.admin, auth.user.id))) return new NextResponse(null, { status: 204 });

  const parsed = parseClientBatch(body, auth.user.id);
  if (!parsed.events.length) return NextResponse.json({ ok: true, stored: 0, dropped: parsed.dropped });
  const stored = await recordEvents(auth.admin, await withRegions(auth.admin, parsed.events));
  return NextResponse.json({ ok: true, stored, dropped: parsed.dropped });
}
