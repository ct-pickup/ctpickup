import { NextResponse } from "next/server";
import { lookupPickupPlayerByUsernameOrEmail } from "@/lib/pickup/lookupPlayerByIdentifier";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { captainMayManageRosterStatus, PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { syncCaptainPlayersPaid } from "@/lib/tournament/syncCaptainPlayersPaid";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function authUserId(req: Request): Promise<string | NextResponse> {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const anon = getSupabaseAnon();
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user?.id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });
  return u.user.id;
}

function rosterSlotsUsed(rows: { status: string }[]) {
  return rows.filter((r) => r.status === "invited" || r.status === "accepted").length;
}

async function playerDisplayName(admin: ReturnType<typeof getSupabaseAdmin>, uid: string) {
  const { data: prof } = await admin
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", uid)
    .maybeSingle();
  if (!prof) return "A player";
  const n = `${prof.first_name || ""} ${prof.last_name || ""}`.trim();
  return n || prof.username || "A player";
}

export async function GET(req: Request) {
  const userIdOrRes = await authUserId(req);
  if (userIdOrRes instanceof NextResponse) return userIdOrRes;
  const userId = userIdOrRes;

  const admin = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const captainId = (searchParams.get("captain_id") || "").trim();
  const tournamentId = (searchParams.get("tournament_id") || "").trim();
  const joinCatalog = searchParams.get("join_catalog") === "1";

  if (joinCatalog && tournamentId) {
    const regionQ = (searchParams.get("region") || "").trim().toUpperCase();
    const { data: t, error: tErr } = await admin
      .from("tournaments")
      .select("id, service_region")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!t) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });
    const svc = t.service_region != null ? String(t.service_region).trim().toUpperCase() : null;
    if (regionQ && svc && svc !== regionQ) {
      return NextResponse.json({ error: "region_mismatch" }, { status: 403 });
    }

    const { data: caps, error: cErr } = await admin
      .from("tournament_captains")
      .select("id, team_name, captain_name, expected_players, user_id")
      .eq("tournament_id", tournamentId)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    const teams: Array<{
      captain_id: string;
      team_name: string;
      captain_name: string;
      spots_remaining: number;
      expected_players: number;
    }> = [];

    for (const c of caps || []) {
      const capId = String((c as { id: string }).id);
      const expected = Number((c as { expected_players?: unknown }).expected_players ?? 0) || 0;
      const { data: roster } = await admin.from("tournament_roster").select("status").eq("captain_id", capId);
      const used = rosterSlotsUsed((roster || []) as { status: string }[]);
      const capSlots = Math.max(0, expected - 1);
      teams.push({
        captain_id: capId,
        team_name: String((c as { team_name?: string }).team_name ?? ""),
        captain_name: String((c as { captain_name?: string }).captain_name ?? ""),
        expected_players: expected,
        spots_remaining: Math.max(0, capSlots - used),
      });
    }

    const { data: myReq } = await admin
      .from("tournament_join_requests")
      .select("id, captain_id, status, message, created_at")
      .eq("tournament_id", tournamentId)
      .eq("requester_user_id", userId)
      .eq("status", "pending");

    return NextResponse.json({ teams, my_pending_requests: myReq ?? [] });
  }

  if (!captainId) {
    return NextResponse.json({ error: "missing_captain_id" }, { status: 400 });
  }

  const { data: cap, error: capErr } = await admin
    .from("tournament_captains")
    .select("id, user_id, tournament_id, team_name, captain_name, expected_players, status")
    .eq("id", captainId)
    .maybeSingle();

  if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });
  if (!cap) return NextResponse.json({ error: "captain_not_found" }, { status: 404 });
  if (String(cap.user_id) !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: rosterRows, error: rErr } = await admin
    .from("tournament_roster")
    .select("id, user_id, status, invited_at, responded_at")
    .eq("captain_id", captainId)
    .order("invited_at", { ascending: true });

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const ids = [...new Set((rosterRows || []).map((x: { user_id: string }) => x.user_id))];
  let profileMap: Record<
    string,
    { first_name: string | null; last_name: string | null; username: string | null; playing_position: string | null }
  > = {};
  if (ids.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, first_name, last_name, username, playing_position")
      .in("id", ids);
    profileMap = Object.fromEntries(
      (profs || []).map((p: any) => [
        p.id,
        {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          username: p.username ?? null,
          playing_position: p.playing_position ?? null,
        },
      ]),
    );
  }

  const { data: reqs, error: reqErr } = await admin
    .from("tournament_join_requests")
    .select("id, requester_user_id, message, status, created_at, responded_at")
    .eq("captain_id", captainId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 });

  const reqIds = [...new Set((reqs || []).map((x: { requester_user_id: string }) => x.requester_user_id))];
  let reqProfileMap: typeof profileMap = {};
  if (reqIds.length) {
    const { data: rprofs } = await admin
      .from("profiles")
      .select("id, first_name, last_name, username, playing_position")
      .in("id", reqIds);
    reqProfileMap = Object.fromEntries(
      (rprofs || []).map((p: any) => [
        p.id,
        {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          username: p.username ?? null,
          playing_position: p.playing_position ?? null,
        },
      ]),
    );
  }

  const roster = (rosterRows || []).map((row: any) => {
    const prof = profileMap[row.user_id] || null;
    const display =
      prof && (prof.first_name || prof.last_name)
        ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim()
        : prof?.username || row.user_id;
    return {
      ...row,
      display_name: display,
      username: prof?.username ?? null,
      playing_position: prof?.playing_position ?? null,
    };
  });

  const join_requests = (reqs || []).map((row: any) => {
    const prof = reqProfileMap[row.requester_user_id] || null;
    const display =
      prof && (prof.first_name || prof.last_name)
        ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim()
        : prof?.username || row.requester_user_id;
    return {
      ...row,
      display_name: display,
      username: prof?.username ?? null,
      playing_position: prof?.playing_position ?? null,
    };
  });

  return NextResponse.json({
    captain: cap,
    roster,
    join_requests,
  });
}

export async function POST(req: Request) {
  const userIdOrRes = await authUserId(req);
  if (userIdOrRes instanceof NextResponse) return userIdOrRes;
  const userId = userIdOrRes;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const action = String((body as { action?: unknown }).action || "").trim();
  if (!action) return NextResponse.json({ error: "missing_action" }, { status: 400 });

  if (action === "invite_player") {
    const captain_id = String((body as { captain_id?: unknown }).captain_id || "").trim();
    const tournament_id = String((body as { tournament_id?: unknown }).tournament_id || "").trim();
    const identifier = String((body as { identifier?: unknown }).identifier || "").trim();
    if (!captain_id || !tournament_id || !identifier) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const { data: cap, error: capErr } = await admin
      .from("tournament_captains")
      .select("id, user_id, tournament_id, expected_players, status, team_name, captain_name")
      .eq("id", captain_id)
      .maybeSingle();
    if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });
    if (!cap || String(cap.user_id) !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (String(cap.tournament_id) !== tournament_id) return NextResponse.json({ error: "tournament_mismatch" }, { status: 400 });
    if (!captainMayManageRosterStatus(String(cap.status))) {
      return NextResponse.json({ error: "captain_not_confirmed" }, { status: 400 });
    }

    const player = await lookupPickupPlayerByUsernameOrEmail(admin, identifier);
    if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });
    if (player.user_id === userId) return NextResponse.json({ error: "cannot_invite_self" }, { status: 400 });

    const { data: rosterList } = await admin.from("tournament_roster").select("status").eq("captain_id", captain_id);
    const used = rosterSlotsUsed((rosterList || []) as { status: string }[]);
    const expected = Number(cap.expected_players ?? 0) || 0;
    const capSlots = Math.max(0, expected - 1);
    if (used >= capSlots) return NextResponse.json({ error: "roster_full" }, { status: 409 });

    const { data: existing } = await admin
      .from("tournament_roster")
      .select("id, status")
      .eq("captain_id", captain_id)
      .eq("user_id", player.user_id)
      .maybeSingle();

    if (existing) {
      if (existing.status === "declined") {
        const { data: upd, error: upErr } = await admin
          .from("tournament_roster")
          .update({
            status: "invited",
            invited_at: new Date().toISOString(),
            responded_at: null,
          })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
        await sendPushToUsers(admin, [player.user_id], {
          title: "Tournament team invite",
          body: `You've been invited to join ${String(cap.team_name || "a team")} for the CT Pickup Tournament.`,
          data: { kind: "tournament_roster_invite", roster_id: upd.id, tournament_id, captain_id },
        });
        await syncCaptainPlayersPaid(admin, captain_id);
        return NextResponse.json({ roster: upd });
      }
      return NextResponse.json({ error: "already_on_roster" }, { status: 409 });
    }

    const { data: row, error: insErr } = await admin
      .from("tournament_roster")
      .insert({
        tournament_id,
        captain_id,
        user_id: player.user_id,
        status: "invited",
      })
      .select("*")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    await sendPushToUsers(admin, [player.user_id], {
      title: "Tournament team invite",
      body: `You've been invited to join ${String(cap.team_name || "a team")} for the CT Pickup Tournament.`,
      data: { kind: "tournament_roster_invite", roster_id: row.id, tournament_id, captain_id },
    });

    await syncCaptainPlayersPaid(admin, captain_id);
    return NextResponse.json({ roster: row });
  }

  if (action === "respond") {
    const roster_id = String((body as { roster_id?: unknown }).roster_id || "").trim();
    const accept = Boolean((body as { accept?: unknown }).accept);
    if (!roster_id) return NextResponse.json({ error: "missing_roster_id" }, { status: 400 });

    const { data: row, error } = await admin.from("tournament_roster").select("*").eq("id", roster_id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (String(row.user_id) !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (String(row.status) !== "invited") return NextResponse.json({ error: "invalid_status" }, { status: 400 });

    const nextStatus = accept ? "accepted" : "declined";
    const { data: upd, error: uErr } = await admin
      .from("tournament_roster")
      .update({ status: nextStatus, responded_at: new Date().toISOString() })
      .eq("id", roster_id)
      .select("*")
      .single();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    const { data: cap } = await admin.from("tournament_captains").select("user_id, team_name").eq("id", row.captain_id).maybeSingle();
    if (cap?.user_id) {
      const who = await playerDisplayName(admin, String(upd.user_id));
      await sendPushToUsers(admin, [String(cap.user_id)], {
        title: "Roster update",
        body: accept ? `${who} accepted your tournament invite.` : `${who} declined your tournament invite.`,
        data: {
          kind: "tournament_roster_response",
          roster_id,
          accept,
          tournament_id: String(row.tournament_id),
        },
      });
    }

    await syncCaptainPlayersPaid(admin, String(row.captain_id));
    return NextResponse.json({ roster: upd });
  }

  if (action === "remove") {
    const roster_id = String((body as { roster_id?: unknown }).roster_id || "").trim();
    if (!roster_id) return NextResponse.json({ error: "missing_roster_id" }, { status: 400 });

    const { data: row, error } = await admin.from("tournament_roster").select("captain_id").eq("id", roster_id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: cap, error: cErr } = await admin.from("tournament_captains").select("user_id").eq("id", row.captain_id).maybeSingle();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (!cap || String(cap.user_id) !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const { error: dErr } = await admin.from("tournament_roster").delete().eq("id", roster_id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    await syncCaptainPlayersPaid(admin, String(row.captain_id));
    return NextResponse.json({ ok: true });
  }

  if (action === "request_join") {
    const captain_id = String((body as { captain_id?: unknown }).captain_id || "").trim();
    const tournament_id = String((body as { tournament_id?: unknown }).tournament_id || "").trim();
    const message =
      typeof (body as { message?: unknown }).message === "string" ? String((body as { message: string }).message).trim().slice(0, 500) : null;
    if (!captain_id || !tournament_id) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    const { data: cap, error: capErr } = await admin
      .from("tournament_captains")
      .select("id, user_id, tournament_id, status, team_name, captain_name, expected_players")
      .eq("id", captain_id)
      .maybeSingle();
    if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });
    if (!cap || String(cap.tournament_id) !== tournament_id) return NextResponse.json({ error: "invalid_team" }, { status: 400 });
    if (!captainMayManageRosterStatus(String(cap.status)))
      return NextResponse.json({ error: "team_not_confirmed" }, { status: 400 });
    if (String(cap.user_id) === userId) return NextResponse.json({ error: "cannot_join_own_team" }, { status: 400 });

    const { data: rosterList } = await admin.from("tournament_roster").select("status").eq("captain_id", captain_id);
    const used = rosterSlotsUsed((rosterList || []) as { status: string }[]);
    const expected = Number(cap.expected_players ?? 0) || 0;
    const capSlots = Math.max(0, expected - 1);
    if (used >= capSlots) return NextResponse.json({ error: "roster_full" }, { status: 409 });

    const { data: dup } = await admin
      .from("tournament_join_requests")
      .select("id, status")
      .eq("captain_id", captain_id)
      .eq("requester_user_id", userId)
      .maybeSingle();
    if (dup && String(dup.status) === "pending") {
      return NextResponse.json({ error: "request_already_pending" }, { status: 409 });
    }

    const { data: onRoster } = await admin
      .from("tournament_roster")
      .select("id, status")
      .eq("captain_id", captain_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (onRoster && (onRoster.status === "invited" || onRoster.status === "accepted")) {
      return NextResponse.json({ error: "already_on_roster" }, { status: 409 });
    }

    let reqRow: Record<string, unknown> | null = null;
    let insErr: { message: string } | null = null;
    if (dup && String(dup.status) !== "pending") {
      const up = await admin
        .from("tournament_join_requests")
        .update({
          status: "pending",
          message: message || null,
          created_at: new Date().toISOString(),
          responded_at: null,
        })
        .eq("id", dup.id)
        .select("*")
        .single();
      reqRow = up.data as Record<string, unknown> | null;
      insErr = up.error;
    } else {
      const ins = await admin
        .from("tournament_join_requests")
        .insert({
          tournament_id,
          captain_id,
          requester_user_id: userId,
          message: message || null,
          status: "pending",
        })
        .select("*")
        .single();
      reqRow = ins.data as Record<string, unknown> | null;
      insErr = ins.error;
    }

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    if (!reqRow) return NextResponse.json({ error: "save_failed" }, { status: 500 });

    await sendPushToUsers(admin, [String(cap.user_id)], {
      title: "Join request",
      body: `A player requested to join ${String(cap.team_name || "your team")}.`,
      data: { kind: "tournament_join_request", request_id: reqRow.id as string, tournament_id, captain_id },
    });

    return NextResponse.json({ request: reqRow });
  }

  if (action === "respond_request") {
    const request_id = String((body as { request_id?: unknown }).request_id || "").trim();
    const approve = Boolean((body as { approve?: unknown }).approve);
    if (!request_id) return NextResponse.json({ error: "missing_request_id" }, { status: 400 });

    const { data: reqRow, error } = await admin.from("tournament_join_requests").select("*").eq("id", request_id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!reqRow) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (String(reqRow.status) !== "pending") return NextResponse.json({ error: "not_pending" }, { status: 400 });

    const { data: cap, error: cErr } = await admin
      .from("tournament_captains")
      .select("user_id, expected_players, team_name, status")
      .eq("id", reqRow.captain_id)
      .maybeSingle();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (!cap || String(cap.user_id) !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (!captainMayManageRosterStatus(String(cap.status))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();
    if (!approve) {
      const { data: upd, error: uErr } = await admin
        .from("tournament_join_requests")
        .update({ status: "declined", responded_at: now })
        .eq("id", request_id)
        .select("*")
        .single();
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
      await sendPushToUsers(admin, [String(reqRow.requester_user_id)], {
        title: "Join request update",
        body: `Your request to join ${String(cap.team_name || "the team")} was declined.`,
        data: {
          kind: "tournament_join_decision",
          request_id,
          approved: false,
          tournament_id: String(reqRow.tournament_id),
        },
      });
      return NextResponse.json({ request: upd });
    }

    const { data: rosterList } = await admin.from("tournament_roster").select("status").eq("captain_id", reqRow.captain_id);
    const used = rosterSlotsUsed((rosterList || []) as { status: string }[]);
    const expected = Number(cap.expected_players ?? 0) || 0;
    const capSlots = Math.max(0, expected - 1);
    if (used >= capSlots) return NextResponse.json({ error: "roster_full" }, { status: 409 });

    const { data: existingR } = await admin
      .from("tournament_roster")
      .select("id, status")
      .eq("captain_id", reqRow.captain_id)
      .eq("user_id", reqRow.requester_user_id)
      .maybeSingle();

    let rosterOut;
    if (existingR) {
      const { data: rUp, error: rErr } = await admin
        .from("tournament_roster")
        .update({ status: "accepted", responded_at: now })
        .eq("id", existingR.id)
        .select("*")
        .single();
      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
      rosterOut = rUp;
    } else {
      const { data: rIns, error: rErr } = await admin
        .from("tournament_roster")
        .insert({
          tournament_id: reqRow.tournament_id,
          captain_id: reqRow.captain_id,
          user_id: reqRow.requester_user_id,
          status: "accepted",
          invited_at: now,
          responded_at: now,
        })
        .select("*")
        .single();
      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
      rosterOut = rIns;
    }

    const { data: updReq, error: rqErr } = await admin
      .from("tournament_join_requests")
      .update({ status: "approved", responded_at: now })
      .eq("id", request_id)
      .select("*")
      .single();
    if (rqErr) return NextResponse.json({ error: rqErr.message }, { status: 500 });

    await sendPushToUsers(admin, [String(reqRow.requester_user_id)], {
      title: "You're on the team",
      body: `You were added to ${String(cap.team_name || "the tournament team")}.`,
      data: {
        kind: "tournament_join_decision",
        request_id,
        approved: true,
        roster_id: rosterOut?.id,
        tournament_id: String(reqRow.tournament_id),
      },
    });

    await syncCaptainPlayersPaid(admin, String(reqRow.captain_id));
    return NextResponse.json({ request: updReq, roster: rosterOut });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
