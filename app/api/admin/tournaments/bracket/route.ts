import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { recalculateOutdoorGroupStandings } from "@/lib/tournament/recalculateOutdoorGroupStandings";

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

export async function GET(req: Request) {
  try {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", u.data.user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tournament_id = searchParams.get("tournament_id");
  if (!tournament_id) {
    return NextResponse.json({ error: "Missing tournament_id query parameter" }, { status: 400 });
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

  const teams = (teamsRes.data ?? []) as { id: string; team_name: string; captain_name: string }[];
  const capIds = teams.map((t) => String(t.id));

  type RosterPlayer = { name: string; team_id: string; team_name: string };
  const roster_players: RosterPlayer[] = [];
  const seenRoster = new Set<string>();

  for (const t of teams) {
    const capName = String(t.captain_name ?? "").trim();
    if (!capName) continue;
    const key = `${t.id}|${capName.toLowerCase()}`;
    if (seenRoster.has(key)) continue;
    seenRoster.add(key);
    roster_players.push({
      name: capName,
      team_id: t.id,
      team_name: String(t.team_name ?? "").trim() || "Team",
    });
  }

  if (capIds.length) {
    const rosterRes = await admin
      .from("tournament_roster")
      .select("user_id, captain_id, status")
      .in("captain_id", capIds)
      .in("status", ["invited", "accepted"]);
    if (rosterRes.error) return NextResponse.json({ error: rosterRes.error.message }, { status: 500 });

    const userIds = [
      ...new Set(
        (rosterRes.data ?? [])
          .map((r: { user_id?: string | null }) => (typeof r.user_id === "string" ? r.user_id : ""))
          .filter(Boolean),
      ),
    ];
    const profileMap: Record<string, { first_name: string | null; last_name: string | null; username: string | null }> =
      {};
    if (userIds.length) {
      const profRes = await admin
        .from("profiles")
        .select("id, first_name, last_name, username")
        .in("id", userIds);
      if (profRes.error) return NextResponse.json({ error: profRes.error.message }, { status: 500 });
      for (const p of profRes.data ?? []) {
        profileMap[String((p as { id: string }).id)] = {
          first_name: (p as { first_name?: string | null }).first_name ?? null,
          last_name: (p as { last_name?: string | null }).last_name ?? null,
          username: (p as { username?: string | null }).username ?? null,
        };
      }
    }

    const teamByCap = new Map(teams.map((t) => [String(t.id), t]));
    for (const row of rosterRes.data ?? []) {
      const capId = String((row as { captain_id: string }).captain_id);
      const uid = String((row as { user_id: string }).user_id);
      const team = teamByCap.get(capId);
      if (!team) continue;
      const prof = profileMap[uid];
      const name =
        prof && (prof.first_name || prof.last_name)
          ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim()
          : String(prof?.username ?? "").trim();
      if (!name) continue;
      const key = `${capId}|${name.toLowerCase()}`;
      if (seenRoster.has(key)) continue;
      seenRoster.add(key);
      roster_players.push({
        name,
        team_id: capId,
        team_name: String(team.team_name ?? "").trim() || "Team",
      });
    }
  }

  roster_players.sort(
    (a, b) => a.team_name.localeCompare(b.team_name) || a.name.localeCompare(b.name),
  );

  const goalsRes = await admin
    .from("tournament_match_goals")
    .select("match_id, team_id, scorer_name, minute, is_own_goal")
    .eq("tournament_id", tournament_id);

  if (goalsRes.error) return NextResponse.json({ error: goalsRes.error.message }, { status: 500 });

  const match_goals: Record<
    string,
    { team_id: string; scorer_name: string; minute: number | null; is_own_goal: boolean }[]
  > = {};
  for (const g of goalsRes.data ?? []) {
    const mid = String((g as { match_id: string }).match_id);
    if (!match_goals[mid]) match_goals[mid] = [];
    const minuteRaw = (g as { minute?: unknown }).minute;
    const minute =
      minuteRaw === null || minuteRaw === undefined
        ? null
        : Number.isFinite(Number(minuteRaw))
          ? Math.trunc(Number(minuteRaw))
          : null;
    match_goals[mid].push({
      team_id: String((g as { team_id: string }).team_id),
      scorer_name: String((g as { scorer_name?: string }).scorer_name ?? "").trim(),
      minute,
      is_own_goal: Boolean((g as { is_own_goal?: boolean }).is_own_goal),
    });
  }

  return NextResponse.json({
    teams,
    matches: matchesRes.data ?? [],
    standings: standingsRes.data ?? [],
    roster_players,
    match_goals,
  });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[tournaments/bracket GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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
    const { data: tour, error: tErr } = await admin
      .from("tournaments")
      .select("id,min_roster_players")
      .eq("id", tournament_id)
      .maybeSingle();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!tour) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

    const minRoster = Number((tour as { min_roster_players?: unknown }).min_roster_players ?? 5) || 5;

    const teamsRes = await admin
      .from("tournament_captains")
      .select("id, team_name, captain_name")
      .eq("tournament_id", tournament_id)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]);

    if (teamsRes.error) return NextResponse.json({ error: teamsRes.error.message }, { status: 500 });
    const teams = shuffle(teamsRes.data || []);
    const teamCount = teams.length;

    if (teamCount < 8 || teamCount > 12) {
      return NextResponse.json({ error: `Need 8-12 paid teams, got ${teamCount}` }, { status: 400 });
    }

    for (const tm of teams) {
      const capId = (tm as { id: string }).id;
      const { data: ros } = await admin.from("tournament_roster").select("status").eq("captain_id", capId);
      const accepted = (ros || []).filter((r: { status: string }) => r.status === "accepted").length;
      const headcount = 1 + accepted;
      if (headcount < minRoster) {
        return NextResponse.json(
          {
            error: `Team “${String((tm as { team_name?: string }).team_name || "Team")}” has ${headcount} roster players (including captain). Minimum is ${minRoster}.`,
          },
          { status: 400 },
        );
      }
    }

    const config = getGroupConfig(teamCount);
    const groupNames = ["A", "B", "C"];

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

      const groupRes = await admin
        .from("tournament_groups")
        .insert({ tournament_id, group_name: groupName })
        .select("id")
        .single();

      if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 500 });
      const groupId = groupRes.data.id;

      await admin.from("tournament_group_members").insert(
        groupTeams.map((t) => ({
          group_id: groupId,
          tournament_id,
          team_id: (t as { id: string }).id,
        })),
      );

      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          await admin.from("tournament_matches").insert({
            tournament_id,
            stage: "group",
            group_name: groupName,
            match_number: matchNumber++,
            team_a_id: (groupTeams[i] as { id: string }).id,
            team_b_id: (groupTeams[j] as { id: string }).id,
          });
        }
      }
    }

    const recap = await recalculateOutdoorGroupStandings(admin, tournament_id);
    if (!recap.ok) return NextResponse.json({ error: recap.error }, { status: 500 });

    const { data: capPush } = await admin
      .from("tournament_captains")
      .select("user_id")
      .eq("tournament_id", tournament_id)
      .in("id", teams.map((x) => (x as { id: string }).id));
    const ids = [...new Set((capPush || []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];
    if (ids.length) {
      await sendPushToUsers(admin, ids, {
        title: "Bracket is live",
        body: "Group stage matches are published. Open Tournaments → View bracket.",
        data: { kind: "tournament_bracket_generated", tournament_id },
      });
    }

    return NextResponse.json({ ok: true, message: `Generated groups for ${teamCount} teams` });
  }

  if (action === "log_score") {
    const { match_id, score_a, score_b, goals } = body;

    const matchRes = await admin.from("tournament_matches").select("*").eq("id", match_id).maybeSingle();
    if (!matchRes.data) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const match = matchRes.data;
    if (String(match.tournament_id) !== String(tournament_id)) {
      return NextResponse.json({ error: "Tournament mismatch" }, { status: 400 });
    }

    let winner_id = null;
    if (score_a !== score_b) {
      winner_id = score_a > score_b ? match.team_a_id : match.team_b_id;
    }

    await admin
      .from("tournament_matches")
      .update({
        score_a,
        score_b,
        winner_id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", match_id);

    await admin.from("tournament_match_goals").delete().eq("match_id", match_id);

    if (goals && goals.length > 0) {
      await admin.from("tournament_match_goals").insert(
        goals.map((g: { team_id: string; scorer_name: string; minute: unknown; is_own_goal?: boolean }) => ({
          match_id,
          tournament_id,
          team_id: g.team_id,
          scorer_name: g.scorer_name,
          minute: g.minute,
          is_own_goal: g.is_own_goal || false,
        })),
      );
    }

    if (match.stage === "group") {
      const recap = await recalculateOutdoorGroupStandings(admin, tournament_id);
      if (!recap.ok) return NextResponse.json({ error: recap.error }, { status: 500 });
    }

    const teamAId = match.team_a_id as string | null;
    const teamBId = match.team_b_id as string | null;
    const isBye = Boolean(match.is_bye);
    if (teamAId && teamBId && !isBye) {
      const { data: capTeams } = await admin
        .from("tournament_captains")
        .select("id, user_id, team_name")
        .in("id", [teamAId, teamBId]);
      const teamAName = String(
        (capTeams || []).find((c: { id: string }) => String(c.id) === String(teamAId))?.team_name ?? "Team A",
      );
      const teamBName = String(
        (capTeams || []).find((c: { id: string }) => String(c.id) === String(teamBId))?.team_name ?? "Team B",
      );
      const captainUserIds = [
        ...new Set(
          (capTeams || [])
            .map((c: { user_id?: string | null }) => (typeof c.user_id === "string" ? c.user_id : ""))
            .filter(Boolean),
        ),
      ];
      const { data: rosterRows } = await admin
        .from("tournament_roster")
        .select("user_id")
        .in("captain_id", [teamAId, teamBId])
        .eq("status", "accepted");
      const rosterUserIds = [
        ...new Set(
          (rosterRows || [])
            .map((r: { user_id?: string | null }) => (typeof r.user_id === "string" ? r.user_id : ""))
            .filter(Boolean),
        ),
      ];
      const notifyUserIds = [...new Set([...captainUserIds, ...rosterUserIds])];
      if (notifyUserIds.length) {
        await sendPushToUsers(admin, notifyUserIds, {
          title: "Vote for Match MVP ⭐",
          body: `Who stood out in ${teamAName} vs ${teamBName}? Vote now.`,
          data: {
            kind: "tournament_mvp_vote",
            match_id,
            tournament_id: String(tournament_id),
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "generate_knockout") {
    await admin.from("tournament_matches").delete().eq("tournament_id", tournament_id).in("stage", ["qf", "sf", "final"]);

    const groupsRes = await admin
      .from("tournament_groups")
      .select("id,group_name")
      .eq("tournament_id", tournament_id)
      .order("group_name", { ascending: true });

    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 500 });

    const groupRows = groupsRes.data || [];
    if (groupRows.length < 2) {
      return NextResponse.json({ error: "Need at least 2 groups before knockout." }, { status: 400 });
    }

    const standings = await admin
      .from("tournament_group_members")
      .select("group_id,team_id,points,goal_difference,goals_for")
      .eq("tournament_id", tournament_id);

    if (standings.error) return NextResponse.json({ error: standings.error.message }, { status: 500 });

    type MemberStandingRow = {
      group_id: string;
      team_id: string;
      points: number;
      goal_difference: number;
      goals_for: number;
    };

    const byGroup = new Map<string, MemberStandingRow[]>();
    for (const row of standings.data || []) {
      const r = row as MemberStandingRow;
      const gid = String(r.group_id);
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(r);
    }

    type Qual = { groupName: string; winnerId: string; runnerId: string };
    const qualifiers: Qual[] = [];

    for (const g of groupRows) {
      const gid = String(g.id);
      const gName = String(g.group_name || "");
      const mems = byGroup.get(gid) || [];
      const sorted = [...mems].sort(
        (a, b) =>
          b.points - a.points ||
          b.goal_difference - a.goal_difference ||
          b.goals_for - a.goals_for,
      );
      if (sorted.length < 2) {
        return NextResponse.json(
          { error: `Group ${gName || gid} needs at least 2 teams with standings before knockout.` },
          { status: 400 },
        );
      }
      qualifiers.push({
        groupName: gName,
        winnerId: sorted[0].team_id,
        runnerId: sorted[1].team_id,
      });
    }

    const pairs: { team_a_id: string; team_b_id: string }[] = [];
    const n = qualifiers.length;
    for (let i = 0; i < n; i++) {
      const wi = qualifiers[i].winnerId;
      const rNext = qualifiers[(i + 1) % n].runnerId;
      pairs.push({ team_a_id: wi, team_b_id: rNext });
    }

    let matchNumber = 1000;
    const stage = pairs.length <= 2 ? "sf" : "qf";

    for (const p of pairs) {
      await admin.from("tournament_matches").insert({
        tournament_id,
        stage,
        match_number: matchNumber++,
        team_a_id: p.team_a_id,
        team_b_id: p.team_b_id,
        is_bye: false,
        winner_id: null,
        completed_at: null,
      });
    }

    return NextResponse.json({ ok: true, message: "Knockout stage generated" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[tournaments/bracket POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
