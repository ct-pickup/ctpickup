import { NextResponse } from "next/server";

import { submitReport } from "@/lib/fields/venueReports";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "fields-report";
const PER_HOUR = 20;

/**
 * POST /api/fields/report  { venue_key, problem, note?, detail?, duplicate_of?, lat?, lon? }
 * A signed-in player reports a problem with a field. Saved as a pending correction for an admin. When 3 different players say a
 * field does not exist or is not a soccer field, the field is hidden from the map until an admin looks.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  try {
    const res = await submitReport(auth.admin, auth.user.id, {
      venue_key: typeof body.venue_key === "string" ? body.venue_key : "",
      problem: body.problem as never,
      note: typeof body.note === "string" ? body.note : null,
      detail: typeof body.detail === "string" ? body.detail : null,
      duplicate_of: typeof body.duplicate_of === "string" ? body.duplicate_of : null,
      lat: num(body.lat),
      lon: num(body.lon),
    });
    if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "invalid" ? 400 : res.code === "venue_missing" ? 404 : res.code === "rate_limited" ? 429 : 500 });
    // The player never learns whether their report hid the field.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/fields/report] failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t save that. Please try again." }, { status: 500 });
  }
}
