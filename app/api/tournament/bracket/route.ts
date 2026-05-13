import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { userMayViewOutdoorTournamentBracket } from "@/lib/tournament/resolveOutdoorHubRegionForUser";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Read-only bracket payload for signed-in players (same shape as admin bracket GET). */
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
    return NextResponse.json({ error: "This bracket is not available for your region." }, { status: 403 });
  }

  const [teamsRes, matchesRes, standingsRes] = await Promise.all([
    admin
      .from("tournament_captains")
      .select("id, team_name, captain_name")
      .eq("tournament_id", tournament_id)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]),
    admin
      .from("tournament_matches")
      .select("*")
      .eq("tournament_id", tournament_id)
      .order("match_number", { ascending: true }),
    admin.from("tournament_group_members").select("*").eq("tournament_id", tournament_id),
  ]);

  if (teamsRes.error) return NextResponse.json({ error: teamsRes.error.message }, { status: 500 });
  if (matchesRes.error) return NextResponse.json({ error: matchesRes.error.message }, { status: 500 });
  if (standingsRes.error) return NextResponse.json({ error: standingsRes.error.message }, { status: 500 });

  return NextResponse.json({
    teams: teamsRes.data ?? [],
    matches: matchesRes.data ?? [],
    standings: standingsRes.data ?? [],
  });
}
