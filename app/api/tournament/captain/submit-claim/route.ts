import { NextResponse } from "next/server";
import { fetchAdminUserIds } from "@/lib/push/adminUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { isActiveCaptainClaimStatus } from "@/lib/tournament/outdoorTournamentConstants";
import { resolveOutdoorHubRegionForUser } from "@/lib/tournament/resolveOutdoorHubRegionForUser";
import { selectActiveOutdoorTournamentForRegion } from "@/lib/tournament/selectActiveOutdoorTournament";

function normIg(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const anon = getSupabaseAnon();

  const nowMs = Date.now();

  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const waiverOk = await userHasAcceptedCurrentWaiver(u.user.id);
  if (!waiverOk) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const { data: prof } = await admin.from("profiles").select("approved").eq("id", u.user.id).maybeSingle();
  if (!prof?.approved) {
    return NextResponse.json({ error: "account_not_approved" }, { status: 403 });
  }

  const body = await req.json();

  const captainName = String(body?.captainName || "").trim();
  const captainInstagram = normIg(String(body?.captainInstagram || ""));
  const teamName = String(body?.teamName || "").trim();
  const expectedPlayers = Number(body?.expectedPlayers || 0);

  const prelim = Array.isArray(body?.prelimRoster) ? body.prelimRoster : [];
  const bodyRegion =
    body?.service_region != null && typeof body.service_region === "string"
      ? String(body.service_region).trim().toUpperCase()
      : null;

  if (!captainName || captainName.length < 2) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (!captainInstagram || captainInstagram.length < 2)
    return NextResponse.json({ error: "missing_instagram" }, { status: 400 });
  if (!teamName || teamName.length < 2) return NextResponse.json({ error: "missing_team_name" }, { status: 400 });
  if (!Number.isFinite(expectedPlayers) || expectedPlayers < 5 || expectedPlayers > 25) {
    return NextResponse.json({ error: "expected_players_invalid" }, { status: 400 });
  }

  const resolvedRegion = await resolveOutdoorHubRegionForUser(admin, u.user.id, bodyRegion);
  const { data: t, error: tSelErr } = await selectActiveOutdoorTournamentForRegion(admin, resolvedRegion);
  if (tSelErr) return NextResponse.json({ error: tSelErr.message }, { status: 500 });
  if (!t) return NextResponse.json({ error: "no_active_tournament" }, { status: 404 });

  const startAtMs =
    typeof (t as { start_at?: unknown }).start_at === "string"
      ? new Date(String((t as { start_at: string }).start_at)).getTime()
      : NaN;
  if (Number.isFinite(startAtMs)) {
    const cutoffMs = startAtMs - 24 * 60 * 60 * 1000;
    if (cutoffMs < nowMs) {
      return NextResponse.json(
        { error: "Claims are closed within 24 hours of the tournament. Roster is now free-for-all." },
        { status: 403 },
      );
    }
  }

  const maxTeams = Number((t as { max_teams?: unknown }).max_teams ?? 0);
  const { data: allCaps } = await admin.from("tournament_captains").select("status").eq("tournament_id", t.id);

  const claimed = (allCaps || []).filter((c) => isActiveCaptainClaimStatus(c.status)).length;
  if (Number.isFinite(maxTeams) && maxTeams > 0 && claimed >= maxTeams) {
    return NextResponse.json({ error: "captain_slots_full" }, { status: 409 });
  }

  const { data: dupIg } = await admin
    .from("tournament_captains")
    .select("id, user_id, status")
    .eq("tournament_id", t.id)
    .eq("captain_instagram", captainInstagram)
    .limit(5);

  const dupActive = (dupIg || []).some(
    (x) => x.user_id !== u.user.id && isActiveCaptainClaimStatus(x.status as string),
  );
  if (dupActive) {
    return NextResponse.json({ error: "instagram_already_on_active_team" }, { status: 409 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  const userAgent = req.headers.get("user-agent") || "";

  const { data: cap, error: capErr } = await admin
    .from("tournament_captains")
    .upsert(
      {
        tournament_id: t.id,
        user_id: u.user.id,
        status: "claim_submitted",
        captain_verified: false,
        captain_name: captainName,
        captain_instagram: captainInstagram,
        team_name: teamName,
        expected_players: expectedPlayers,
        claim_submitted_at: new Date().toISOString(),
        ip,
        user_agent: userAgent,
      },
      { onConflict: "tournament_id,user_id" },
    )
    .select("*")
    .single();

  if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });
  if (!cap) return NextResponse.json({ error: "Upsert returned no row" }, { status: 500 });

  const adminIds = await fetchAdminUserIds(admin);
  if ("error" in adminIds) {
    console.error("[submit-claim] admin ids:", adminIds.error);
  } else if (adminIds.ids.length) {
    await sendPushToUsers(admin, adminIds.ids, {
      title: "Captain claim submitted",
      body: `${teamName} — ${captainName} submitted a tournament captain claim.`,
      data: { kind: "tournament_captain_claim_admin", tournament_id: t.id, captain_id: cap.id },
    });
  }

  await admin.from("tournament_roster_prelim").delete().eq("captain_id", cap.id);

  const cleanPrelim = prelim
    .map((p: { fullName?: unknown; instagram?: unknown }) => ({
      full_name: String(p?.fullName || "").trim(),
      instagram: normIg(String(p?.instagram || "")),
    }))
    .filter((p) => p.full_name.length >= 2 && p.instagram.length >= 2)
    .slice(0, 12);

  if (cleanPrelim.length) {
    await admin.from("tournament_roster_prelim").insert(
      cleanPrelim.map((p) => ({
        tournament_id: t.id,
        captain_id: cap.id,
        full_name: p.full_name,
        instagram: p.instagram,
      })),
    );
  }

  return NextResponse.json({ captain: cap });
}
