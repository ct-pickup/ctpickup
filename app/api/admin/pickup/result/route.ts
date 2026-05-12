import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { applyPickupResultWinLossDeltas } from "@/lib/pickup/applyPickupResultWinLoss";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Team = "A" | "B" | "C";

function isTeam(v: unknown): v is Team {
  return v === "A" || v === "B" || v === "C";
}

function asUuid(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

function unique(xs: string[]) {
  return Array.from(new Set(xs.filter(Boolean)));
}

async function applyGoalieOfTheDayDelta(
  supabase: ReturnType<typeof supabaseService>,
  oldGoalieOfTheDay: string | null,
  newGoalieOfTheDay: string | null,
) {
  const deltas = new Map<string, number>();
  if (oldGoalieOfTheDay) deltas.set(oldGoalieOfTheDay, (deltas.get(oldGoalieOfTheDay) || 0) - 1);
  if (newGoalieOfTheDay) deltas.set(newGoalieOfTheDay, (deltas.get(newGoalieOfTheDay) || 0) + 1);

  const now = new Date().toISOString();
  for (const [uid, delta] of deltas.entries()) {
    if (!delta) continue;
    const profRes = await supabase
      .from("profiles")
      .select("goalie_of_the_day_count")
      .eq("id", uid)
      .maybeSingle();
    if (profRes.error || !profRes.data) {
      console.error("[pickup/result] goalie award profile read failed:", profRes.error?.message, uid);
      continue;
    }
    const current = Number((profRes.data as { goalie_of_the_day_count?: number | null }).goalie_of_the_day_count ?? 0);
    const next = Math.max(0, current + delta);
    const up = await supabase
      .from("profiles")
      .update({ goalie_of_the_day_count: next, updated_at: now })
      .eq("id", uid);
    if (up.error) {
      console.error("[pickup/result] goalie award profile update failed:", up.error.message, uid);
    }
  }
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const supabase = supabaseService();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;

  const run_id = asUuid(b.run_id);
  const total_teams = Number(b.total_teams);
  const winning_team = b.winning_team;

  const team_assignments = Array.isArray(b.team_assignments) ? b.team_assignments : null;

  const player_of_day = b.player_of_day == null ? null : asUuid(b.player_of_day);
  const goalie_of_the_day = b.goalie_of_the_day == null ? null : asUuid(b.goalie_of_the_day);
  const defender_of_day = b.defender_of_day == null ? null : asUuid(b.defender_of_day);
  const midfielder_of_day = b.midfielder_of_day == null ? null : asUuid(b.midfielder_of_day);
  const attacker_of_day = b.attacker_of_day == null ? null : asUuid(b.attacker_of_day);

  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  if (![2, 3].includes(total_teams)) {
    return NextResponse.json({ error: "total_teams must be 2 or 3" }, { status: 400 });
  }
  if (!isTeam(winning_team)) {
    return NextResponse.json({ error: "winning_team must be A, B, or C" }, { status: 400 });
  }
  if (!team_assignments) {
    return NextResponse.json({ error: "team_assignments required" }, { status: 400 });
  }

  const assignments: { user_id: string; team: Team }[] = [];
  for (const row of team_assignments) {
    const r = (row ?? {}) as Record<string, unknown>;
    const user_id = asUuid(r.user_id);
    const team = r.team;
    if (!user_id || !isTeam(team)) {
      return NextResponse.json({ error: "Invalid team_assignments row" }, { status: 400 });
    }
    assignments.push({ user_id, team });
  }

  const oldResultRes = await supabase
    .from("pickup_run_results")
    .select("winning_team,goalie_of_the_day")
    .eq("run_id", run_id)
    .maybeSingle();
  const oldAssignRes = await supabase.from("pickup_run_team_assignments").select("user_id,team").eq("run_id", run_id);

  const oldWinningTeam =
    oldResultRes.data?.winning_team && isTeam(oldResultRes.data.winning_team)
      ? oldResultRes.data.winning_team
      : null;
  const oldGoalieOfTheDay =
    typeof oldResultRes.data?.goalie_of_the_day === "string" ? oldResultRes.data.goalie_of_the_day : null;
  const oldAssignments: { user_id: string; team: Team }[] = [];
  for (const row of oldAssignRes.data || []) {
    const r = row as { user_id: string; team: unknown };
    if (!r.user_id || !isTeam(r.team)) continue;
    oldAssignments.push({ user_id: r.user_id, team: r.team });
  }

  // 1) Upsert result row for the run.
  const upRes = await supabase
    .from("pickup_run_results")
    .upsert(
      {
        run_id,
        total_teams,
        winning_team,
        player_of_day,
        goalie_of_the_day,
        defender_of_day,
        midfielder_of_day,
        attacker_of_day,
        created_by: guard.userId,
      },
      { onConflict: "run_id" },
    )
    .select("run_id")
    .single();

  if (upRes.error) {
    return NextResponse.json({ error: upRes.error.message }, { status: 500 });
  }

  // 2) Replace team assignments (idempotent for edits).
  const del = await supabase.from("pickup_run_team_assignments").delete().eq("run_id", run_id);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  }

  if (assignments.length > 0) {
    const ins = await supabase.from("pickup_run_team_assignments").insert(
      assignments.map((a) => ({
        run_id,
        user_id: a.user_id,
        team: a.team,
        created_by: guard.userId,
      })),
    );
    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
  }

  await applyPickupResultWinLossDeltas(supabase, {
    oldWinningTeam,
    oldAssignments,
    newWinningTeam: winning_team,
    newAssignments: assignments,
  });
  await applyGoalieOfTheDayDelta(supabase, oldGoalieOfTheDay, goalie_of_the_day);

  // 3) Push notifications: confirmed players + award winners.
  const rsvps = await supabase
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", run_id)
    .eq("status", "confirmed");

  const confirmedIds = unique(((rsvps.data ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id || ""));

  if (confirmedIds.length) {
    await sendPushToUsers(supabase, confirmedIds, {
      title: "Stats updated",
      body: "Your stats were updated.",
      data: { kind: "pickup_result", run_id },
    });
  }

  const awardMap: Array<{ userId: string | null; title: string; body: string; kind: string }> = [
    {
      userId: player_of_day,
      title: "You won Player of the Day!",
      body: "Congrats — you were named Player of the Day.",
      kind: "pickup_award_player",
    },
    {
      userId: goalie_of_the_day,
      title: "Goalie of the Day 🧤",
      body: "You were named Goalie of the Day. Well saved!",
      kind: "pickup_award_goalie",
    },
    {
      userId: defender_of_day,
      title: "You won Defender of the Day!",
      body: "Congrats — you were named Defender of the Day.",
      kind: "pickup_award_defender",
    },
    {
      userId: midfielder_of_day,
      title: "You won Midfielder of the Day!",
      body: "Congrats — you were named Midfielder of the Day.",
      kind: "pickup_award_midfielder",
    },
    {
      userId: attacker_of_day,
      title: "You won Attacker of the Day!",
      body: "Congrats — you were named Attacker of the Day.",
      kind: "pickup_award_attacker",
    },
  ];

  for (const a of awardMap) {
    if (!a.userId) continue;
    await sendPushToUsers(supabase, [a.userId], {
      title: a.title,
      body: a.body,
      data: { kind: a.kind, run_id },
    });
  }

  return NextResponse.json({ ok: true });
}

