import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { loadPublicBracket } from "@/lib/tournament/publicBracket";
import { userMayViewOutdoorTournamentBracket } from "@/lib/tournament/resolveOutdoorHubRegionForUser";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Read-only bracket for signed-in players: teams (name, roster names, seed, team average), matches with status and scores,
 * group standings, the knockout rounds still to fill in, and top scorers. The payload is built from an allow-list in
 * lib/tournament/publicBracket.ts, so no contact, payment or review field can reach a player from here.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const anon = getSupabaseAnon();
  const { data: authData, error: uErr } = await anon.auth.getUser(token);
  const authedUser = authData?.user;
  if (uErr || !authedUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tournament_id = searchParams.get("tournament_id");
  if (!tournament_id) {
    return NextResponse.json({ error: "Missing tournament_id query parameter" }, { status: 400 });
  }

  const allowed = await userMayViewOutdoorTournamentBracket(admin, authedUser.id, tournament_id);
  if (!allowed) {
    return NextResponse.json({ error: "You need an approved account to view this bracket." }, { status: 403 });
  }

  const loaded = await loadPublicBracket(admin, tournament_id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });

  return NextResponse.json(loaded.bracket, { headers: { "Cache-Control": "no-store" } });
}
