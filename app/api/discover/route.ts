import { NextResponse } from "next/server";

import { DiscoverError, weeklyPicks } from "@/lib/discover/discoverService";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * GET /api/discover
 *
 * The viewer's five picks for the current Eastern week. Eligibility and field
 * selection are enforced here, not in the app: the response carries no location,
 * contact details, score, tier or reliability.
 */
export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const token = bearer(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData.user?.id) {
      return NextResponse.json({ error: authErr ? authErr.message : "Unauthorized" }, { status: 401 });
    }

    const viewerId = userData.user.id;
    const viewerProf = await admin.from("profiles").select("approved,is_admin").eq("id", viewerId).maybeSingle();
    const approved = viewerProf.data?.approved === true || viewerProf.data?.is_admin === true;
    if (!approved) {
      return NextResponse.json({ error: "Your account must be approved to see player picks." }, { status: 403 });
    }

    const result = await weeklyPicks(admin, viewerId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DiscoverError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "We could not load your picks right now." }, { status: 500 });
  }
}
