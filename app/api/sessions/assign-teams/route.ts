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
  const assignments = body.assignments as { user_id: string; team: string }[];

  if (!run_id || !Array.isArray(assignments)) {
    return NextResponse.json({ error: "run_id and assignments required" }, { status: 400 });
  }

  // Verify caller is host or admin
  const { data: run } = await admin.from("pickup_runs").select("created_by").eq("id", run_id).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!run || (run.created_by !== user.id && !prof?.is_admin)) {
    return NextResponse.json({ error: "Only the host can assign teams." }, { status: 403 });
  }

  const rows = assignments.map((a) => ({
    run_id,
    user_id: a.user_id,
    team: a.team,
  }));

  const { error } = await admin.from("pickup_run_team_assignments")
    .upsert(rows, { onConflict: "run_id,user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
