import { NextResponse } from "next/server";

import { checkSearchRate, DiscoverError, searchPlayers } from "@/lib/discover/discoverService";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * GET /api/discover/search?q=
 *
 * Exact full name or exact @username only, at most three results. A partial query
 * returns an empty list, so this cannot be walked to enumerate players. Limited to
 * 30 calls per user per hour.
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
      return NextResponse.json({ error: "Your account must be approved to search players." }, { status: 403 });
    }

    const query = (new URL(req.url).searchParams.get("q") || "").trim();
    if (!query) {
      return NextResponse.json({ players: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    await checkSearchRate(admin, viewerId);
    const players = await searchPlayers(admin, viewerId, query);
    return NextResponse.json({ players }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DiscoverError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "We could not run that search right now." }, { status: 500 });
  }
}
