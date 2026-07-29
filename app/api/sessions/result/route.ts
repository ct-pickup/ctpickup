import { NextResponse } from "next/server";
import { applyPickupResultWinLossDeltas } from "@/lib/pickup/applyPickupResultWinLoss";
import { resolvePotdFromVotes } from "@/lib/pickup/resolvePotdFromVotes";
import {
  asAwardUserId,
  resolveSessionResultAwards,
  type SessionAwardCountField,
} from "@/lib/pickup/sessionResultAwards";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type Team = "A" | "B" | "C";

type AwardField = SessionAwardCountField;

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function isTeam(v: unknown): v is Team {
  return v === "A" || v === "B" || v === "C";
}

function asUuid(v: unknown): string | null {
  return asAwardUserId(v);
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

/** Apply ±1 to a profile award counter (idempotent across result edits). */
async function applyAwardDelta(
  admin: ReturnType<typeof getSupabaseAdmin>,
  field: AwardField,
  oldUserId: string | null,
  newUserId: string | null,
  now: string,
): Promise<void> {
  const deltas = new Map<string, number>();
  if (oldUserId) deltas.set(oldUserId, (deltas.get(oldUserId) || 0) - 1);
  if (newUserId) deltas.set(newUserId, (deltas.get(newUserId) || 0) + 1);

  console.log("[sessions/result] applyAwardDelta called", {
    field,
    oldUserId,
    newUserId,
    deltas: Object.fromEntries(deltas),
  });

  for (const [userId, delta] of deltas.entries()) {
    if (!delta) continue;
    console.log("[sessions/result] applyAwardDelta applying", { userId, field, delta });

    const { data, error: selErr } = await admin
      .from("profiles")
      .select(field)
      .eq("id", userId)
      .maybeSingle();
    if (selErr) {
      console.error("[sessions/result] award count select failed", {
        field,
        userId,
        error: selErr.message,
      });
      continue;
    }
    if (!data) {
      console.error("[sessions/result] award count profile missing", { field, userId });
      continue;
    }

    const raw = (data as Record<string, unknown>)[field];
    const current = Number.isFinite(Number(raw)) ? Number(raw) : 0;
    const next = Math.max(0, current + delta);
    const patch: Record<string, unknown> = {
      [field]: next,
      updated_at: now,
    };
    // Keep legacy goalie column in sync with goalie_potd_count.
    if (field === "goalie_potd_count") {
      const { data: legacy, error: legacyErr } = await admin
        .from("profiles")
        .select("goalie_of_the_day_count")
        .eq("id", userId)
        .maybeSingle();
      if (legacyErr) {
        console.error("[sessions/result] legacy goalie count select failed", {
          userId,
          error: legacyErr.message,
        });
      } else {
        const legacyCurrent = Number(
          (legacy as { goalie_of_the_day_count?: number | null } | null)?.goalie_of_the_day_count ?? 0,
        );
        patch.goalie_of_the_day_count = Math.max(
          0,
          (Number.isFinite(legacyCurrent) ? legacyCurrent : 0) + delta,
        );
      }
    }

    console.log("[sessions/result] updating award count", {
      userId,
      field,
      current,
      next,
      delta,
    });

    const { data: updated, error } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select(`id,${field}`)
      .maybeSingle();
    if (error) {
      console.error("[sessions/result] award count update failed", {
        field,
        userId,
        error: error.message,
      });
      continue;
    }
    console.log("[sessions/result] award count updated", {
      userId,
      field,
      saved: (updated as Record<string, unknown> | null)?.[field] ?? null,
    });
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
  const awards = resolveSessionResultAwards(body);
  const {
    defender_of_day,
    midfielder_of_day,
    attacker_of_day,
    goalie_of_the_day,
  } = awards;
  // Host pick is optional tiebreaker only — POTD is resolved from attendee votes.
  const hostPotdTiebreaker = awards.player_of_day;

  if (!run_id || !winning_team_raw) {
    return NextResponse.json({ error: "run_id and winning_team required" }, { status: 400 });
  }
  if (!isTeam(winning_team_raw)) {
    return NextResponse.json({ error: "winning_team must be A, B, or C" }, { status: 400 });
  }
  const winning_team = winning_team_raw;

  const { data: run } = await admin
    .from("pickup_runs")
    .select("created_by,title")
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

  const potdResolution = await resolvePotdFromVotes(admin, run_id, hostPotdTiebreaker);
  const player_of_day = potdResolution.winnerId;

  console.log("[sessions/result] awards resolved", {
    run_id,
    player_of_day,
    potd_votes: potdResolution.totalVotes,
    potd_tied: potdResolution.tied,
    host_tiebreaker: hostPotdTiebreaker,
    defender_of_day,
    midfielder_of_day,
    attacker_of_day,
    goalie_of_the_day,
  });

  const now = new Date().toISOString();

  const { data: oldResult } = await admin
    .from("pickup_run_results")
    .select(
      "winning_team,player_of_day,defender_of_day,midfielder_of_day,attacker_of_day,goalie_of_the_day",
    )
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

  const oldPlayer = asUuid(oldResult?.player_of_day);
  const oldDefender = asUuid(oldResult?.defender_of_day);
  const oldMidfielder = asUuid(oldResult?.midfielder_of_day);
  const oldAttacker = asUuid(oldResult?.attacker_of_day);
  const oldGoalie = asUuid(oldResult?.goalie_of_the_day);

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

  await admin
    .from("pickup_runs")
    .update({ status: "completed", updated_at: now })
    .eq("id", run_id);

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

  // Award counters on profiles (idempotent on re-save).
  await applyAwardDelta(admin, "potd_count", oldPlayer, player_of_day, now);
  await applyAwardDelta(admin, "goalie_potd_count", oldGoalie, goalie_of_the_day, now);
  await applyAwardDelta(admin, "defender_potd_count", oldDefender, defender_of_day, now);
  await applyAwardDelta(admin, "midfielder_potd_count", oldMidfielder, midfielder_of_day, now);
  await applyAwardDelta(admin, "attacker_potd_count", oldAttacker, attacker_of_day, now);

  console.log("[sessions/result] awards applied", {
    player_of_day,
    defender_of_day,
    midfielder_of_day,
    attacker_of_day,
    goalie_of_the_day,
    potd_vote_count: potdResolution.voteCount,
    potd_total_votes: potdResolution.totalVotes,
  });

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

  if (isFirstResult) {
    console.log("[sessions/result] bumping attended/sessions", {
      run_id,
      attendees: attendeeIds.length,
      assigned: assignments.length,
    });
    await bumpAttendedAndSessions(admin, attendeeIds, now);
  }

  // Push: all attendees get the result summary.
  if (attendeeIds.length > 0) {
    try {
      await sendPushToUsers(admin, attendeeIds, {
        title: "Session results are in!",
        body: `Team ${winning_team} won. Check who won the awards.`,
        data: {
          kind: "session_result",
          screen: `session/${run_id}`,
          run_id,
          url: `ctpickup://session/${run_id}`,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sessions/result] attendee push failed", msg);
    }
  }

  // Push: individual award winners (only newly awarded on this save).
  const awardPushes: Array<{ userId: string | null; title: string; body: string; kind: string }> = [
    {
      userId: player_of_day && player_of_day !== oldPlayer ? player_of_day : null,
      title: "You won Player of the Day! 🏆",
      body: "Congrats — you were named Player of the Day.",
      kind: "pickup_award_player",
    },
    {
      userId: goalie_of_the_day && goalie_of_the_day !== oldGoalie ? goalie_of_the_day : null,
      title: "You won Goalie of the Day! 🧤",
      body: "Congrats — you were named Goalie of the Day.",
      kind: "pickup_award_goalie",
    },
    {
      userId: defender_of_day && defender_of_day !== oldDefender ? defender_of_day : null,
      title: "You won Defender of the Day! 🛡️",
      body: "Congrats — you were named Defender of the Day.",
      kind: "pickup_award_defender",
    },
    {
      userId: midfielder_of_day && midfielder_of_day !== oldMidfielder ? midfielder_of_day : null,
      title: "You won Midfielder of the Day! ⚽",
      body: "Congrats — you were named Midfielder of the Day.",
      kind: "pickup_award_midfielder",
    },
    {
      userId: attacker_of_day && attacker_of_day !== oldAttacker ? attacker_of_day : null,
      title: "You won Attacker of the Day! 🔥",
      body: "Congrats — you were named Attacker of the Day.",
      kind: "pickup_award_attacker",
    },
  ];

  for (const a of awardPushes) {
    if (!a.userId) continue;
    try {
      await sendPushToUsers(admin, [a.userId], {
        title: a.title,
        body: a.body,
        data: {
          kind: a.kind,
          screen: `session/${run_id}`,
          run_id,
          url: `ctpickup://session/${run_id}`,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sessions/result] award push failed", { kind: a.kind, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    first_result: isFirstResult,
    assigned_players: assignments.length,
    awards: {
      player_of_day,
      defender_of_day,
      midfielder_of_day,
      attacker_of_day,
      goalie_of_the_day,
    },
    potd: {
      winner_id: player_of_day,
      vote_count: potdResolution.voteCount,
      total_votes: potdResolution.totalVotes,
      tied: potdResolution.tied,
      counts: potdResolution.counts,
    },
  });
}
