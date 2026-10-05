import { NextResponse } from "next/server";

import { directoryPage, parseDirectoryQuery } from "@/lib/discover/directory";
import { DiscoverError } from "@/lib/discover/discoverService";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { DIRECTORY_REQUESTS_PER_HOUR } from "@/shared/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * GET /api/discover/directory?position=&min_star=&max_star=&max_drive=&cursor=
 *
 * One page (20) of the player directory. Distance is only ever a range (driveBucket), never exact minutes; max_drive
 * must be 15, 30 or 45 (anything else is a 400). CT+ is gated in the app only; this route has no server-side subscription
 * check, so it is safe for any approved member: same people and same fields as Discover, rate limited, and never
 * deeper than DIRECTORY_MAX_OFFSET players into a filtered list.
 */
export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const viewerId = userData.user.id;

    const viewerProf = await admin.from("profiles").select("approved,is_admin").eq("id", viewerId).maybeSingle();
    if (!(viewerProf.data?.approved === true || viewerProf.data?.is_admin === true)) {
      return NextResponse.json({ error: "Your account must be approved to see players." }, { status: 403 });
    }

    const parsed = parseDirectoryQuery(new URL(req.url).searchParams);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Its own counter (bucket "discover-directory:<user id>"). Fails open if the store is down.
    const limited = await checkPersistentRateLimit({ route: "discover-directory", ip: viewerId, limit: DIRECTORY_REQUESTS_PER_HOUR, windowSeconds: 3600 });
    if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

    const result = await directoryPage(admin, viewerId, parsed.query);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DiscoverError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "We could not load players right now." }, { status: 500 });
  }
}
