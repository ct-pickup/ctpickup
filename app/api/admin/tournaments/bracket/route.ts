import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { isMissingColumn } from "@/lib/tournament/paymentConfig";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { logMatchScore, startMatch } from "@/lib/tournament/logScore";
import { recalculateOutdoorGroupStandings } from "@/lib/tournament/recalculateOutdoorGroupStandings";
import { forgetMatchRecords, loadMatchRatings, loadRatingOptions, rateScoredMatch, setRatingOptions } from "@/lib/tournament/ratedTournament";
import { ratingOptionsView } from "@/shared/ratedTournament";
import { loadExactRatings } from "@/lib/ratings/exactRatings";
import { seedTeams } from "@/lib/tournament/seeding";
import { drawSeededGroups } from "@/lib/tournament/seededDraw";
import { recordTournamentActivationChange } from "@/lib/admin/surfaceHealth";
import { finishTournament, isFinished } from "@/lib/tournament/finishTournament";
import { CONFIRM_REQUIRED_CODE, groupsNeedConfirm, groupsWipeMessage, knockoutNeedsConfirm, knockoutWipeMessage, loadWipeSummary } from "@/lib/tournament/generateGuard";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
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

  // Rated tournaments: the two switches (and whether Rated is locked), and for each scored match whether it counted and why not.
  // Codes only: no rating is ever sent to a client.
  const ratingOpts = await loadRatingOptions(admin, tournament_id);
  const rating_options = ratingOptionsView(ratingOpts);
  const match_ratings = ratingOpts.rated ? await loadMatchRatings(admin, tournament_id) : {};

  const stateRes = await admin.from("tournaments").select("is_active,canceled_at").eq("id", tournament_id).maybeSingle();
  const stateRow = (stateRes.error ? null : stateRes.data) as { is_active?: boolean | null; canceled_at?: string | null } | null;
  const tournament_status = {
    is_active: stateRow?.is_active === true,
    canceled: !!stateRow?.canceled_at,
    finished: isFinished(stateRow ?? {}, (matchesRes.data ?? []) as { stage?: string | null; completed_at?: string | null; is_bye?: boolean | null }[]),
  };

  return NextResponse.json({
    teams,
    matches: matchesRes.data ?? [],
    tournament_status,
    standings: standingsRes.data ?? [],
    roster_players,
    match_goals,
    rating_options,
    match_ratings,
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
      .select("id, team_name, captain_name, user_id")
      .eq("tournament_id", tournament_id)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]);

    if (teamsRes.error) return NextResponse.json({ error: teamsRes.error.message }, { status: 500 });
    const teams = teamsRes.data || [];
    const teamCount = teams.length;

    if (teamCount < 8 || teamCount > 12) {
      return NextResponse.json({ error: `Need 8-12 paid teams, got ${teamCount}` }, { status: 400 });
    }

    // Everyone on each team (the captain and accepted roster players), for the seeding below.
    const membersByTeam = new Map<string, string[]>();
    for (const tm of teams) {
      const capId = (tm as { id: string }).id;
      const { data: ros } = await admin.from("tournament_roster").select("status, user_id").eq("captain_id", capId);
      const acceptedRows = (ros || []).filter((r: { status: string }) => r.status === "accepted");
      const accepted = acceptedRows.length;
      const captainUid = (tm as { user_id?: string | null }).user_id;
      membersByTeam.set(capId, [
        ...(captainUid ? [String(captainUid)] : []),
        ...acceptedRows.map((r: { user_id?: string | null }) => String(r.user_id ?? "")).filter(Boolean),
      ]);
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

    // THE SEEDED DRAW: rank by the average exact rating of each team's players (current ratings, read now), split into pots of one team per
    // group, deal each pot across the groups at random. A rating read that fails leaves nobody rated, which is a plain random draw.
    const allUserIds = [...new Set([...membersByTeam.values()].flat())];
    const ratings = await loadExactRatings(admin, allUserIds);
    const avgs = seedTeams(
      teams.map((t) => ({ id: String((t as { id: string }).id), team_name: String((t as { team_name?: string }).team_name ?? "Team"), user_ids: membersByTeam.get(String((t as { id: string }).id)) ?? [] })),
      ratings,
    );
    const avgById = new Map(avgs.map((a) => [a.id, a.team_avg]));
    const draw = drawSeededGroups(
      teams.map((t) => ({ id: String((t as { id: string }).id), name: String((t as { team_name?: string }).team_name ?? "Team"), avg: avgById.get(String((t as { id: string }).id)) ?? null })),
      Math.random,
    );
    const teamById = new Map(teams.map((t) => [String((t as { id: string }).id), t]));

    // Generating again deletes every existing match and group, scored or not. Refuse unless the admin said yes (the app asks first).
    {
      const wipe = await loadWipeSummary(admin, String(tournament_id));
      if (groupsNeedConfirm(wipe) && body.confirm_wipe !== true) {
        return NextResponse.json(
          { error: groupsWipeMessage(wipe), code: CONFIRM_REQUIRED_CODE, needs_confirm: true, scored_matches: wipe.scored_matches, total_matches: wipe.total_matches },
          { status: 409 },
        );
      }
    }

    {
      // A rated tournament takes its rating effect back out before its matches are deleted.
      const { data: oldMatches } = await admin.from("tournament_matches").select("id").eq("tournament_id", tournament_id);
      await forgetMatchRecords(admin, String(tournament_id), ((oldMatches ?? []) as { id: string }[]).map((m) => String(m.id)));
    }
    await admin.from("tournament_matches").delete().eq("tournament_id", tournament_id);
    await admin.from("tournament_group_members").delete().eq("tournament_id", tournament_id);
    await admin.from("tournament_groups").delete().eq("tournament_id", tournament_id);

    let matchNumber = 1;

    for (let g = 0; g < draw.groups.length; g++) {
      const groupName = draw.groups[g]!.name;
      const groupTeams = draw.groups[g]!.teams.map((d) => teamById.get(d.id)!);
      const drawnById = new Map(draw.groups[g]!.teams.map((d) => [d.id, d]));

      const groupRes = await admin
        .from("tournament_groups")
        .insert({ tournament_id, group_name: groupName })
        .select("id")
        .single();

      if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 500 });
      const groupId = groupRes.data.id;

      // The seed, pot and average each team had at draw time are stored with its place in the group (migration 20261109000000). Before that
      // migration the columns do not exist, so the same rows are written without them and the draw still works.
      const memberRows = groupTeams.map((t) => {
        const d = drawnById.get((t as { id: string }).id)!;
        return { group_id: groupId, tournament_id, team_id: (t as { id: string }).id, seed: d.seed, pot: d.pot, draw_avg: d.avg };
      });
      const ins = await admin.from("tournament_group_members").insert(memberRows);
      if (ins.error) {
        if (isMissingColumn(ins.error)) {
          await admin.from("tournament_group_members").insert(memberRows.map((row) => ({ group_id: row.group_id, tournament_id: row.tournament_id, team_id: row.team_id })));
        } else {
          return NextResponse.json({ error: ins.error.message }, { status: 500 });
        }
      }

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

    // The record of the draw (who was seeded where, in which pot and group). Averages are the display rating, never a raw score.
    try {
      await admin.from("admin_audit_log").insert({
        actor_id: u.data.user.id,
        action: "tournament_group_draw",
        detail: {
          tournament_id,
          at: new Date().toISOString(),
          pot_size: draw.pot_size,
          teams: draw.groups.flatMap((gr) => gr.teams.map((d) => ({ team_id: d.id, seed: d.seed, pot: d.pot, avg: d.avg, group: gr.name }))),
        },
      });
    } catch {
      /* the draw already happened; a missing log line must not undo it */
    }

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

    return NextResponse.json({
      ok: true,
      message: `Generated groups for ${teamCount} teams`,
      // For the admin screen only: each team's seed and pot at draw time, by group.
      draw: draw.groups.map((gr) => ({ group: gr.name, teams: gr.teams.map((d) => ({ team_id: d.id, team_name: d.name, seed: d.seed, pot: d.pot })) })),
    });
  }

  if (action === "finish_tournament") {
    // Turns the tournament off for players once the final has a result. No push, no refund, safe to press twice (see lib/tournament/finishTournament.ts).
    const finished = await finishTournament(admin, String(tournament_id));
    if (!finished.ok) return NextResponse.json({ error: finished.error, code: finished.code }, { status: finished.status });
    if (!finished.already_finished) {
      try {
        await recordTournamentActivationChange(admin, u.data.user.id);
      } catch (e) {
        console.warn("[tournaments/bracket] activation change record failed", e instanceof Error ? e.message : String(e));
      }
    }
    return NextResponse.json({ ok: true, already_finished: finished.already_finished });
  }

  if (action === "start_match") {
    const started = await startMatch(admin, String(tournament_id), String(body.match_id ?? ""));
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
    return NextResponse.json({ ok: true, started_at: started.started_at });
  }

  if (action === "log_score") {
    const { match_id, score_a, score_b, goals, winner_id, confirm_reset } = body;
    if (!match_id) return NextResponse.json({ error: "match_id required" }, { status: 400 });

    // One action: score, winner, completed_at, group standings, and the winner moving into the next knockout match.
    const logged = await logMatchScore(admin, {
      tournament_id: String(tournament_id),
      match_id: String(match_id),
      score_a,
      score_b,
      winner_id,
      goals: Array.isArray(goals) ? goals : [],
      confirm_reset: confirm_reset === true,
      beforeApply: (ids) => forgetMatchRecords(admin, String(tournament_id), ids),
    });
    if (!logged.ok) {
      return NextResponse.json({ error: logged.error, code: logged.code, affected: logged.affected }, { status: logged.status });
    }
    const match = logged.match;

    // The MVP vote push goes out once, when the match first gets a result, not on every edit.
    const teamAId = match.team_a_id as string | null;
    const teamBId = match.team_b_id as string | null;
    if (logged.first_completion && teamAId && teamBId && !match.is_bye) {
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
          title: "Vote for Match MVP \u2B50",
          body: `Who stood out in ${teamAName} vs ${teamBName}? Vote now.`,
          data: {
            kind: "tournament_mvp_vote",
            match_id: String(match_id),
            tournament_id: String(tournament_id),
          },
        });
      }
    }

    // Rated tournaments and tournaments that count for the season: record the match and rate it. Nothing happens for any other
    // tournament. A rating problem never fails the score that was just saved. No push is sent for ratings.
    const rating = await rateScoredMatch(admin, { tournamentId: String(tournament_id), matchId: String(match_id), actorId: u.data.user.id });

    return NextResponse.json({
      ok: true,
      winner_id: logged.winner_id,
      won_on_penalties: logged.won_on_penalties,
      advanced: logged.advanced,
      warnings: logged.warnings,
      rating,
    });
  }

  if (action === "set_rating_options") {
    const changed = await setRatingOptions(admin, {
      tournamentId: String(tournament_id),
      rated: body.rated,
      count_for_season: body.count_for_season,
      actorId: u.data.user.id,
    });
    if (!changed.ok) return NextResponse.json({ error: changed.error, code: changed.code }, { status: changed.status });
    const opts = await loadRatingOptions(admin, String(tournament_id));
    return NextResponse.json({ ok: true, rating_options: ratingOptionsView(opts) });
  }

  if (action === "generate_knockout") {
    // Generating again replaces the knockout. Refuse unless the admin said yes when any knockout match already has a result.
    {
      const wipe = await loadWipeSummary(admin, String(tournament_id));
      if (knockoutNeedsConfirm(wipe) && body.confirm_wipe !== true) {
        return NextResponse.json(
          { error: knockoutWipeMessage(wipe), code: CONFIRM_REQUIRED_CODE, needs_confirm: true, scored_matches: wipe.scored_knockout, total_matches: wipe.knockout_matches },
          { status: 409 },
        );
      }
    }

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

    // Only now, with every check passed, are the old knockout matches removed (a rated tournament takes their rating effect back out first).
    {
      const { data: oldKo } = await admin.from("tournament_matches").select("id").eq("tournament_id", tournament_id).in("stage", ["qf", "sf", "final"]);
      await forgetMatchRecords(admin, String(tournament_id), ((oldKo ?? []) as { id: string }[]).map((m) => String(m.id)));
    }
    await admin.from("tournament_matches").delete().eq("tournament_id", tournament_id).in("stage", ["qf", "sf", "final"]);

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
