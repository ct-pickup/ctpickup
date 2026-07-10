import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const run_id = String(body.run_id ?? "").trim();
  const winning_team = String(body.winning_team ?? "").trim();
  const player_of_the_day = body.player_of_the_day as string | null;
  const defender_of_the_day = body.defender_of_the_day as string | null;
  const midfielder_of_the_day = body.midfielder_of_the_day as string | null;
  const attacker_of_the_day = body.attacker_of_the_day as string | null;
  const goalie_of_the_day = body.goalie_of_the_day as string | null;

  if (!run_id || !winning_team) {
    return NextResponse.json({ error: "run_id and winning_team required" }, { status: 400 });
  }

  // Verify caller is host or admin
  const { data: run } = await admin.from("pickup_runs").select("created_by").eq("id", run_id).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!run || (run.created_by !== user.id && !prof?.is_admin)) {
    return NextResponse.json({ error: "Only the host can record results." }, { status: 403 });
  }

  const now = new Date().toISOString();

  // Upsert result
  const { error } = await admin.from("pickup_run_results").upsert({
    run_id,
    winning_team,
    player_of_the_day: player_of_the_day ?? null,
    defender_of_the_day: defender_of_the_day ?? null,
    midfielder_of_the_day: midfielder_of_the_day ?? null,
    attacker_of_the_day: attacker_of_the_day ?? null,
    goalie_of_the_day: goalie_of_the_day ?? null,
    updated_at: now,
  }, { onConflict: "run_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update win/loss counts for attendees
  const { data: assignments } = await admin
    .from("pickup_run_team_assignments")
    .select("user_id, team")
    .eq("run_id", run_id);

  if (assignments) {
    for (const a of assignments) {
      const won = a.team === winning_team;
      const { data: current } = await admin
        .from("profiles")
        .select("attended_count, wins_count, losses_count")
        .eq("id", a.user_id)
        .maybeSingle();

      await admin.from("profiles").update({
        wins_count: (current?.wins_count ?? 0) + (won ? 1 : 0),
        losses_count: (current?.losses_count ?? 0) + (won ? 0 : 1),
        updated_at: now,
      }).eq("id", a.user_id);
    }
  }

  // Award increments
  const awards = [
    { field: "potd_count", user_id: player_of_the_day },
    { field: "defender_potd_count", user_id: defender_of_the_day },
    { field: "midfielder_potd_count", user_id: midfielder_of_the_day },
    { field: "attacker_potd_count", user_id: attacker_of_the_day },
    { field: "goalie_potd_count", user_id: goalie_of_the_day },
  ];

  for (const award of awards) {
    if (!award.user_id) continue;
    const { data: cur } = await admin.from("profiles").select(award.field).eq("id", award.user_id).maybeSingle();
    await admin.from("profiles").update({
      [award.field]: ((cur as any)?.[award.field] ?? 0) + 1,
      updated_at: now,
    }).eq("id", award.user_id);
  }

  return NextResponse.json({ ok: true });
}
