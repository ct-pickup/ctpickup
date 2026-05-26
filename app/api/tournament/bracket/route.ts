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
    return NextResponse.json({ error: "You need an approved account to view this bracket." }, { status: 403 });
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

  const goalsJoinRes = await admin
    .from("tournament_match_goals")
    .select("scorer_name, tournament_matches!inner(tournament_id)")
    .eq("tournament_matches.tournament_id", tournament_id);

  let goalRows: { scorer_name: string | null }[];
  if (!goalsJoinRes.error) {
    goalRows = (goalsJoinRes.data ?? []) as { scorer_name: string | null }[];
  } else {
    const goalsFallback = await admin.from("tournament_match_goals").select("scorer_name").eq("tournament_id", tournament_id);
    if (goalsFallback.error) return NextResponse.json({ error: goalsFallback.error.message }, { status: 500 });
    goalRows = (goalsFallback.data ?? []) as { scorer_name: string | null }[];
  }
  const counts = new Map<string, number>();
  for (const row of goalRows) {
    const name = typeof row.scorer_name === "string" ? row.scorer_name.trim() : "";
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  const top_scorers = sorted.map(([scorer_name, goals], i) => ({
    scorer_name,
    goals,
    rank: i + 1,
  }));

  return NextResponse.json({
    teams: teamsRes.data ?? [],
    matches: matchesRes.data ?? [],
    standings: standingsRes.data ?? [],
    top_scorers,
  });
}
