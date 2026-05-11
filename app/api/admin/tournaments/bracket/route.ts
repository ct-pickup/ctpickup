import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getGroupConfig(teamCount: number): { groupCount: number; teamsPerGroup: number[] } {
  if (teamCount === 8) return { groupCount: 2, teamsPerGroup: [4, 4] };
  if (teamCount === 9) return { groupCount: 3, teamsPerGroup: [3, 3, 3] };
  if (teamCount === 10) return { groupCount: 2, teamsPerGroup: [5, 5] };
  if (teamCount === 11) return { groupCount: 3, teamsPerGroup: [4, 4, 3] };
  if (teamCount === 12) return { groupCount: 3, teamsPerGroup: [4, 4, 4] };
  return { groupCount: 2, teamsPerGroup: [Math.ceil(teamCount / 2), Math.floor(teamCount / 2)] };
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", u.data.user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { action, tournament_id } = body;

  if (action === "generate") {
    // Get confirmed teams
    const teamsRes = await admin
      .from("tournament_captains")
      .select("id, team_name, captain_name")
      .eq("tournament_id", tournament_id)
      .eq("status", "confirmed");

    if (teamsRes.error) return NextResponse.json({ error: teamsRes.error.message }, { status: 500 });
    const teams = shuffle(teamsRes.data || []);
    const teamCount = teams.length;

    if (teamCount < 8 || teamCount > 12) {
      return NextResponse.json({ error: `Need 8-12 confirmed teams, got ${teamCount}` }, { status: 400 });
    }

    const config = getGroupConfig(teamCount);
    const groupNames = ["A", "B", "C"];

    // Delete existing groups and matches
    await admin.from("tournament_matches").delete().eq("tournament_id", tournament_id);
    await admin.from("tournament_group_members").delete().eq("tournament_id", tournament_id);
    await admin.from("tournament_groups").delete().eq("tournament_id", tournament_id);

    let teamIndex = 0;
    let matchNumber = 1;

    for (let g = 0; g < config.groupCount; g++) {
      const groupName = groupNames[g];
      const groupTeamCount = config.teamsPerGroup[g];
      const groupTeams = teams.slice(teamIndex, teamIndex + groupTeamCount);
      teamIndex += groupTeamCount;

      // Create group
      const groupRes = await admin
        .from("tournament_groups")
        .insert({ tournament_id, group_name: groupName })
        .select("id")
        .single();

      if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 500 });
      const groupId = groupRes.data.id;

      // Add group members
      await admin.from("tournament_group_members").insert(
        groupTeams.map((t) => ({
          group_id: groupId,
          tournament_id,
          team_id: t.id,
        }))
      );

      // Generate round-robin matches
      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          await admin.from("tournament_matches").insert({
            tournament_id,
            stage: "group",
            group_name: groupName,
            match_number: matchNumber++,
            team_a_id: groupTeams[i].id,
            team_b_id: groupTeams[j].id,
          });
        }
      }
    }

    return NextResponse.json({ ok: true, message: `Generated groups for ${teamCount} teams` });
  }

  if (action === "log_score") {
    const { match_id, score_a, score_b, goals } = body;

    // Get match
    const matchRes = await admin.from("tournament_matches").select("*").eq("id", match_id).maybeSingle();
    if (!matchRes.data) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const match = matchRes.data;

    // Determine winner
    let winner_id = null;
    if (score_a !== score_b) {
      winner_id = score_a > score_b ? match.team_a_id : match.team_b_id;
    }

    // Update match score
    await admin.from("tournament_matches").update({
      score_a,
      score_b,
      winner_id,
      completed_at: new Date().toISOString(),
    }).eq("id", match_id);

    // Log goal scorers
    if (goals && goals.length > 0) {
      await admin.from("tournament_match_goals").insert(
        goals.map((g: any) => ({
          match_id,
          tournament_id,
          team_id: g.team_id,
          scorer_name: g.scorer_name,
          minute: g.minute,
          is_own_goal: g.is_own_goal || false,
        }))
      );
    }

    // Update group standings if group stage
    if (match.stage === "group") {
      const aWins = score_a > score_b ? 1 : 0;
      const bWins = score_b > score_a ? 1 : 0;
      const draw = score_a === score_b ? 1 : 0;

      // Update team A standings
      const memberA = await admin.from("tournament_group_members")
        .select("*").eq("team_id", match.team_a_id).eq("tournament_id", tournament_id).maybeSingle();
      if (memberA.data) {
        await admin.from("tournament_group_members").update({
          wins: memberA.data.wins + aWins,
          draws: memberA.data.draws + draw,
          losses: memberA.data.losses + bWins,
          goals_for: memberA.data.goals_for + score_a,
          goals_against: memberA.data.goals_against + score_b,
          points: memberA.data.points + (aWins ? 3 : draw ? 1 : 0),
        }).eq("id", memberA.data.id);
      }

      // Update team B standings
      const memberB = await admin.from("tournament_group_members")
        .select("*").eq("team_id", match.team_b_id).eq("tournament_id", tournament_id).maybeSingle();
      if (memberB.data) {
        await admin.from("tournament_group_members").update({
          wins: memberB.data.wins + bWins,
          draws: memberB.data.draws + draw,
          losses: memberB.data.losses + aWins,
          goals_for: memberB.data.goals_for + score_b,
          goals_against: memberB.data.goals_against + score_a,
          points: memberB.data.points + (bWins ? 3 : draw ? 1 : 0),
        }).eq("id", memberB.data.id);
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "generate_knockout") {
    // Get group standings ordered by points, goal_difference
    const standings = await admin
      .from("tournament_group_members")
      .select("*, team:tournament_captains(id, team_name)")
      .eq("tournament_id", tournament_id)
      .order("points", { ascending: false })
      .order("goal_difference", { ascending: false });

    if (standings.error) return NextResponse.json({ error: standings.error.message }, { status: 500 });

    // Get top 2 from each group
    const groups: Record<string, any[]> = {};
    for (const row of standings.data || []) {
      const groupRes = await admin.from("tournament_groups").select("group_name").eq("id", row.group_id).maybeSingle();
      const gName = groupRes.data?.group_name || "A";
      if (!groups[gName]) groups[gName] = [];
      if (groups[gName].length < 2) groups[gName].push(row);
    }

    const qualifiers = Object.values(groups).flat();
    // Sort qualifiers: group winners first by points/GD, then runners up
    const winners = qualifiers.filter((_, i) => i % 2 === 0);
    const runnersUp = qualifiers.filter((_, i) => i % 2 !== 0);
    const knockoutTeams = [...winners, ...runnersUp];

    // Add byes if needed to reach next power of 2
    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(knockoutTeams.length)));
    let matchNumber = 1000;

    // Generate QF/SF/Final matches
    const stage = knockoutTeams.length <= 4 ? "sf" : "qf";
    for (let i = 0; i < knockoutTeams.length; i += 2) {
      const teamA = knockoutTeams[i];
      const teamB = knockoutTeams[i + 1] || null;
      await admin.from("tournament_matches").insert({
        tournament_id,
        stage,
        match_number: matchNumber++,
        team_a_id: teamA.team_id,
        team_b_id: teamB?.team_id || null,
        is_bye: !teamB,
        winner_id: !teamB ? teamA.team_id : null,
        completed_at: !teamB ? new Date().toISOString() : null,
      });
    }

    return NextResponse.json({ ok: true, message: "Knockout stage generated" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
