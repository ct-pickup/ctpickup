import { NextResponse } from "next/server";
import { applyPickupResultWinLossDeltas } from "@/lib/pickup/applyPickupResultWinLoss";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type Team = "A" | "B" | "C";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function isTeam(v: unknown): v is Team {
  return v === "A" || v === "B" || v === "C";
}

function asUuid(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

async function bumpAttendedAndSessions(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
  now: string,
): Promise<void> {
  for (const user_id of userIds) {
    const { data: prof } = await admin
      .from("profiles")
      .select("attended_count")
      .eq("id", user_id)
      .maybeSingle();

    const nextAttended = Math.max(0, Number(prof?.attended_count ?? 0)) + 1;
    const { error: profErr } = await admin
      .from("profiles")
      .update({ attended_count: nextAttended, updated_at: now })
      .eq("id", user_id);

    if (profErr) {
      console.error("[sessions/result] attended_count update failed", {
        user_id,
        error: profErr.message,
      });
    }

    const { data: rating } = await admin
      .from("player_ratings")
      .select("sessions")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!rating) {
      const { error: insErr } = await admin.from("player_ratings").upsert(
        { user_id, sessions: 1, updated_at: now },
        { onConflict: "user_id", ignoreDuplicates: false },
      );
      if (insErr) {
        console.error("[sessions/result] player_ratings insert failed", {
          user_id,
          error: insErr.message,
        });
      }
      continue;
    }

    const nextSessions = Math.max(0, Number(rating.sessions ?? 0)) + 1;
    const { error: rateErr } = await admin
      .from("player_ratings")
      .update({ sessions: nextSessions, updated_at: now })
      .eq("user_id", user_id);

    if (rateErr) {
      console.error("[sessions/result] player_ratings.sessions update failed", {
        user_id,
        error: rateErr.message,
      });
    }
  }
}

async function applyGoalieAwardDelta(
  admin: ReturnType<typeof getSupabaseAdmin>,
  oldGoalie: string | null,
  newGoalie: string | null,
  now: string,
): Promise<void> {
  const deltas = new Map<string, number>();
  if (oldGoalie) deltas.set(oldGoalie, (deltas.get(oldGoalie) || 0) - 1);
  if (newGoalie) deltas.set(newGoalie, (deltas.get(newGoalie) || 0) + 1);

  for (const [uid, delta] of deltas.entries()) {
    if (!delta) continue;
    const { data } = await admin
      .from("profiles")
      .select("goalie_of_the_day_count")
      .eq("id", uid)
      .maybeSingle();
    const current = Number(
      (data as { goalie_of_the_day_count?: number | null } | null)?.goalie_of_the_day_count ?? 0,
    );
    await admin
      .from("profiles")
      .update({
        goalie_of_the_day_count: Math.max(0, current + delta),
        updated_at: now,
      })
      .eq("id", uid);
  }
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const run_id = String(body.run_id ?? "").trim();
  const winning_team_raw = String(body.winning_team ?? "").trim().toUpperCase();
  const player_of_day =
    asUuid(body.player_of_the_day) ?? asUuid(body.player_of_day);
  const defender_of_day =
    asUuid(body.defender_of_the_day) ?? asUuid(body.defender_of_day);
  const midfielder_of_day =
    asUuid(body.midfielder_of_the_day) ?? asUuid(body.midfielder_of_day);
  const attacker_of_day =
    asUuid(body.attacker_of_the_day) ?? asUuid(body.attacker_of_day);
  const goalie_of_the_day =
    asUuid(body.goalie_of_the_day) ?? asUuid(body.goalie_of_day);

  if (!run_id || !winning_team_raw) {
    return NextResponse.json({ error: "run_id and winning_team required" }, { status: 400 });
  }
  if (!isTeam(winning_team_raw)) {
    return NextResponse.json({ error: "winning_team must be A, B, or C" }, { status: 400 });
  }
  const winning_team = winning_team_raw;

  const { data: run } = await admin
    .from("pickup_runs")
    .select("created_by")
    .eq("id", run_id)
    .maybeSingle();
  const { data: prof } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!run || (run.created_by !== user.id && !prof?.is_admin)) {
    return NextResponse.json({ error: "Only the host can record results." }, { status: 403 });
  }

  const now = new Date().toISOString();

  // Snapshot prior result + assignments so win/loss updates stay idempotent on re-save.
  const { data: oldResult } = await admin
    .from("pickup_run_results")
    .select("winning_team,goalie_of_the_day")
    .eq("run_id", run_id)
    .maybeSingle();

  const isFirstResult = !oldResult;

  const { data: assignmentRows } = await admin
    .from("pickup_run_team_assignments")
    .select("user_id, team")
    .eq("run_id", run_id);

  const assignments: { user_id: string; team: Team }[] = [];
  for (const row of assignmentRows ?? []) {
    const uid = typeof row.user_id === "string" ? row.user_id : "";
    if (!uid || !isTeam(row.team)) continue;
    assignments.push({ user_id: uid, team: row.team });
  }

  const oldWinningTeam =
    oldResult?.winning_team && isTeam(oldResult.winning_team) ? oldResult.winning_team : null;
  const oldAssignments: { user_id: string; team: Team }[] = isFirstResult
    ? []
    : assignments.map((a) => ({ ...a }));
  // On re-save, assignments table is the source of truth both before and after
  // (host edits teams separately). Re-apply net delta from old → new winner.
  // If first result, oldAssignments empty → full credit for current teams.

  const oldGoalie =
    typeof oldResult?.goalie_of_the_day === "string" ? oldResult.goalie_of_the_day : null;

  // Correct column names on pickup_run_results (not player_of_the_day / updated_at).
  const { error: upsertErr } = await admin.from("pickup_run_results").upsert(
    {
      run_id,
      total_teams: 2,
      winning_team,
      player_of_day: player_of_day ?? null,
      defender_of_day: defender_of_day ?? null,
      midfielder_of_day: midfielder_of_day ?? null,
      attacker_of_day: attacker_of_day ?? null,
      goalie_of_the_day: goalie_of_the_day ?? null,
      created_by: user.id,
    },
    { onConflict: "run_id" },
  );

  if (upsertErr) {
    console.error("[sessions/result] upsert failed", upsertErr.message);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Mark completed so the session leaves the live board.
  await admin
    .from("pickup_runs")
    .update({ status: "completed", is_completed: true, updated_at: now })
    .eq("id", run_id);

  // Win/loss on profiles.pickup_wins_count / pickup_losses_count.
  // Unassigned players are skipped here (attendance handled separately).
  try {
    await applyPickupResultWinLossDeltas(admin, {
      oldWinningTeam: isFirstResult ? null : oldWinningTeam,
      oldAssignments: isFirstResult ? [] : oldAssignments,
      newWinningTeam: winning_team,
      newAssignments: assignments,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sessions/result] win/loss update failed", msg);
    return NextResponse.json({ error: `Win/loss update failed: ${msg}` }, { status: 500 });
  }

  try {
    await applyGoalieAwardDelta(admin, oldGoalie, goalie_of_the_day, now);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sessions/result] goalie award update failed", msg);
  }

  // Confirmed RSVPs: attendance + rating sessions (first result only to avoid double-count).
  // Players without a team still get attended_count / sessions — just no W/L.
  if (isFirstResult) {
    const { data: rsvps } = await admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", run_id)
      .in("status", ["confirmed", "pending_payment"]);

    const attendeeIds = Array.from(
      new Set(
        (rsvps ?? [])
          .map((r) => (typeof r.user_id === "string" ? r.user_id : ""))
          .filter(Boolean),
      ),
    );

    console.log("[sessions/result] bumping attended/sessions", {
      run_id,
      attendees: attendeeIds.length,
      assigned: assignments.length,
    });

    await bumpAttendedAndSessions(admin, attendeeIds, now);
  }

  // Win rate is computed on the fly in /api/leaderboards from
  // pickup_wins_count / (pickup_wins_count + pickup_losses_count).
  // There is no profiles.pickup_win_rate column.

  return NextResponse.json({
    ok: true,
    first_result: isFirstResult,
    assigned_players: assignments.length,
  });
}
