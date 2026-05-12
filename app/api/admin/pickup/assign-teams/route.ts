import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
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

function teamAllowedForTotal(team: Team, total_teams: number): boolean {
  if (total_teams === 3) return true;
  return team === "A" || team === "B";
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
  const team_assignments = Array.isArray(b.team_assignments) ? b.team_assignments : null;

  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  if (![2, 3].includes(total_teams)) {
    return NextResponse.json({ error: "total_teams must be 2 or 3" }, { status: 400 });
  }
  if (!team_assignments) {
    return NextResponse.json({ error: "team_assignments required" }, { status: 400 });
  }

  const assignments: { user_id: string; team: Team }[] = [];
  const seen = new Set<string>();
  for (const row of team_assignments) {
    const r = (row ?? {}) as Record<string, unknown>;
    const user_id = asUuid(r.user_id);
    const team = r.team;
    if (!user_id || !isTeam(team)) {
      return NextResponse.json({ error: "Invalid team_assignments row" }, { status: 400 });
    }
    if (!teamAllowedForTotal(team, total_teams)) {
      return NextResponse.json({ error: "Team C is not allowed when total_teams is 2" }, { status: 400 });
    }
    if (seen.has(user_id)) {
      return NextResponse.json({ error: "Duplicate user_id in team_assignments" }, { status: 400 });
    }
    seen.add(user_id);
    assignments.push({ user_id, team });
  }

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

  return NextResponse.json({ ok: true });
}
