import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

function displayNameFromProfile(p: ProfileRow | null | undefined): string {
  if (!p) return "";
  const n = `${p.first_name || ""} ${p.last_name || ""}`.trim();
  return n || (p.username ? String(p.username) : "") || "";
}

async function authUserIdFromToken(token: string): Promise<string | null> {
  const anon = getSupabaseAnon();
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user?.id) return null;
  return u.user.id;
}

async function eligiblePlayerNamesForMatch(
  admin: ReturnType<typeof getSupabaseAdmin>,
  teamAId: string,
  teamBId: string | null,
): Promise<string[]> {
  if (!teamBId) return [];
  const { data: caps, error: cErr } = await admin
    .from("tournament_captains")
    .select("id, captain_name")
    .in("id", [teamAId, teamBId]);
  if (cErr) throw new Error(cErr.message);
  const names = new Set<string>();
  for (const c of caps || []) {
    const cn = typeof (c as { captain_name?: unknown }).captain_name === "string"
      ? String((c as { captain_name: string }).captain_name).trim()
      : "";
    if (cn) names.add(cn);
  }
  const { data: roster, error: rErr } = await admin
    .from("tournament_roster")
    .select("user_id")
    .in("captain_id", [teamAId, teamBId])
    .eq("status", "accepted");
  if (rErr) throw new Error(rErr.message);
  const ids = [...new Set((roster || []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];
  if (ids.length) {
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select("id, first_name, last_name, username")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    for (const p of profs || []) {
      const d = displayNameFromProfile(p as ProfileRow);
      if (d) names.add(d);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function userMayVoteOnMatch(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  teamAId: string,
  teamBId: string | null,
): Promise<boolean> {
  if (!teamBId) return false;
  const { data: capHit } = await admin
    .from("tournament_captains")
    .select("id")
    .in("id", [teamAId, teamBId])
    .eq("user_id", userId)
    .limit(1);
  if ((capHit || []).length > 0) return true;
  const { data: rosHit } = await admin
    .from("tournament_roster")
    .select("id")
    .in("captain_id", [teamAId, teamBId])
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1);
  return (rosHit || []).length > 0;
}

function matchHasScoreLogged(m: {
  score_a: number | null;
  score_b: number | null;
  is_bye?: boolean | null;
  team_b_id: string | null;
}): boolean {
  if (!m.team_b_id || m.is_bye) return false;
  return m.score_a !== null && m.score_b !== null;
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const match_id = (searchParams.get("match_id") || "").trim();
  if (!match_id) {
    return NextResponse.json({ error: "Missing match_id" }, { status: 400 });
  }

  const { data: votes, error: vErr } = await admin
    .from("tournament_mvp_votes")
    .select("voted_for_name")
    .eq("match_id", match_id);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of votes || []) {
    const raw = (row as { voted_for_name?: unknown }).voted_for_name;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const maxVotes = counts.size ? Math.max(...counts.values()) : 0;
  const tallies = [...counts.entries()]
    .map(([name, votes]) => ({
      name,
      votes,
      is_winner: maxVotes > 0 && votes === maxVotes,
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ tallies });
  }

  const userId = await authUserIdFromToken(token);
  if (!userId) {
    return NextResponse.json({ tallies });
  }

  const { data: match, error: mErr } = await admin.from("tournament_matches").select("*").eq("id", match_id).maybeSingle();
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (!match) {
    return NextResponse.json({ tallies, my_vote: null, can_vote: false, eligible_players: [] as string[] });
  }

  const ma = match as {
    team_a_id: string;
    team_b_id: string | null;
    score_a: number | null;
    score_b: number | null;
    is_bye?: boolean | null;
  };

  const { data: myRow } = await admin
    .from("tournament_mvp_votes")
    .select("voted_for_name")
    .eq("match_id", match_id)
    .eq("voter_user_id", userId)
    .maybeSingle();
  const my_vote =
    myRow && typeof (myRow as { voted_for_name?: unknown }).voted_for_name === "string"
      ? String((myRow as { voted_for_name: string }).voted_for_name).trim()
      : null;

  let eligible_players: string[] = [];
  let can_vote = false;
  try {
    if (matchHasScoreLogged(ma)) {
      const eligible = await userMayVoteOnMatch(admin, userId, ma.team_a_id, ma.team_b_id);
      eligible_players = eligible ? await eligiblePlayerNamesForMatch(admin, ma.team_a_id, ma.team_b_id) : [];
      can_vote = eligible && !my_vote && eligible_players.length > 0;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({ tallies, my_vote, can_vote, eligible_players });
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await authUserIdFromToken(token);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const match_id = typeof (body as { match_id?: unknown }).match_id === "string"
    ? String((body as { match_id: string }).match_id).trim()
    : "";
  const voted_for_name = typeof (body as { voted_for_name?: unknown }).voted_for_name === "string"
    ? String((body as { voted_for_name: string }).voted_for_name).trim()
    : "";
  if (!match_id || !voted_for_name) {
    return NextResponse.json({ error: "Missing match_id or voted_for_name" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: match, error: mErr } = await admin.from("tournament_matches").select("*").eq("id", match_id).maybeSingle();
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const ma = match as {
    team_a_id: string;
    team_b_id: string | null;
    score_a: number | null;
    score_b: number | null;
    is_bye?: boolean | null;
  };

  if (!matchHasScoreLogged(ma)) {
    return NextResponse.json({ error: "Match is not open for MVP voting" }, { status: 400 });
  }

  const mayVote = await userMayVoteOnMatch(admin, userId, ma.team_a_id, ma.team_b_id);
  if (!mayVote) {
    return NextResponse.json({ error: "Not eligible to vote on this match" }, { status: 403 });
  }

  let allowed: string[];
  try {
    allowed = await eligiblePlayerNamesForMatch(admin, ma.team_a_id, ma.team_b_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup_failed" }, { status: 500 });
  }
  if (!allowed.includes(voted_for_name)) {
    return NextResponse.json({ error: "Invalid voted_for_name" }, { status: 400 });
  }

  const { error: upErr } = await admin.from("tournament_mvp_votes").upsert(
    {
      match_id,
      voter_user_id: userId,
      voted_for_name,
    },
    { onConflict: "match_id,voter_user_id" },
  );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
