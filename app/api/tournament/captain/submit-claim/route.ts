import { NextResponse } from "next/server";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

const ACTIVE_CLAIM_STATUSES = [
  "claim_submitted",
  "payment_pending",
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
  "confirmed",
];

function normIg(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const anon = getSupabaseAnon();

  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const waiverOk = await userHasAcceptedCurrentWaiver(u.user.id);
  if (!waiverOk) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const body = await req.json();

  const captainName = String(body?.captainName || "").trim();
  const captainInstagram = normIg(String(body?.captainInstagram || ""));
  const teamName = String(body?.teamName || "").trim();
  const expectedPlayers = Number(body?.expectedPlayers || 0);

  const prelim = Array.isArray(body?.prelimRoster) ? body.prelimRoster : [];

  if (!captainName || captainName.length < 2) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (!captainInstagram || captainInstagram.length < 2) return NextResponse.json({ error: "missing_instagram" }, { status: 400 });
  if (!teamName || teamName.length < 2) return NextResponse.json({ error: "missing_team_name" }, { status: 400 });
  if (!Number.isFinite(expectedPlayers) || expectedPlayers < 5 || expectedPlayers > 25) {
    return NextResponse.json({ error: "expected_players_invalid" }, { status: 400 });
  }

  const { data: t } = await admin
    .from("tournaments")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!t) return NextResponse.json({ error: "no_active_tournament" }, { status: 404 });

  // Capacity: block new claims if claimed >= target
  const { data: allCaps } = await admin
    .from("tournament_captains")
    .select("status")
    .eq("tournament_id", t.id);

  const claimed = (allCaps || []).filter((c) => ACTIVE_CLAIM_STATUSES.includes(c.status)).length;
  if (claimed >= t.target_teams) {
    return NextResponse.json({ error: "captain_slots_full" }, { status: 409 });
  }

  // Duplicate protection: captain IG only on one active team per tournament
  const { data: dupIg } = await admin
    .from("tournament_captains")
    .select("id, user_id, status")
    .eq("tournament_id", t.id)
    .eq("captain_instagram", captainInstagram)
    .limit(5);

  const dupActive = (dupIg || []).some((x) => x.user_id !== u.user.id && ACTIVE_CLAIM_STATUSES.includes(x.status));
  if (dupActive) {
    return NextResponse.json({ error: "instagram_already_on_active_team" }, { status: 409 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  const userAgent = req.headers.get("user-agent") || "";

  // Upsert captain claim (1 per user per tournament)
  const { data: cap, error: capErr } = await admin
    .from("tournament_captains")
    .upsert(
      {
        tournament_id: t.id,
        user_id: u.user.id,
        status: "claim_submitted",
        captain_name: captainName,
        captain_instagram: captainInstagram,
        team_name: teamName,
        expected_players: expectedPlayers,
        claim_submitted_at: new Date().toISOString(),
        ip,
        user_agent: userAgent,
      },
      { onConflict: "tournament_id,user_id" }
    )
    .select("*")
    .single();

  if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });

  // Replace prelim roster entries
  await admin.from("tournament_roster_prelim").delete().eq("captain_id", cap.id);

  const cleanPrelim = prelim
    .map((p: any) => ({
      full_name: String(p?.fullName || "").trim(),
      instagram: normIg(String(p?.instagram || "")),
    }))
    .filter((p: any) => p.full_name.length >= 2 && p.instagram.length >= 2)
    .slice(0, 12);

  if (cleanPrelim.length) {
    await admin.from("tournament_roster_prelim").insert(
      cleanPrelim.map((p: any) => ({
        tournament_id: t.id,
        captain_id: cap.id,
        full_name: p.full_name,
        instagram: p.instagram,
      }))
    );
  }

  return NextResponse.json({ captain: cap });
}
