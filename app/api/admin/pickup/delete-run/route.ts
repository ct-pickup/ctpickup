import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRunDeletionBlockers, RUN_HAS_PLAYERS_MESSAGE } from "@/lib/pickup/runDeletion";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

async function requireAdmin(req: Request, supabaseAdmin: SupabaseClient): Promise<NextResponse | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const denied = await requireAdmin(req, supabaseAdmin);
  if (denied) return denied;
  const run_id = new URL(req.url).searchParams.get("run_id");
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  const loaded = await loadRunDeletionBlockers(supabaseAdmin, run_id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });
  const { rsvps, payments } = loaded.blockers;
  return NextResponse.json({ rsvps, payments, deletable: rsvps === 0 && payments === 0 });
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const denied = await requireAdmin(req, supabaseAdmin);
  if (denied) return denied;
  const { run_id } = await req.json();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const run = await supabaseAdmin.from("pickup_runs").select("id").eq("id", run_id).maybeSingle();
  if (run.error) return NextResponse.json({ error: run.error.message }, { status: 500 });
  if (!run.data) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const loaded = await loadRunDeletionBlockers(supabaseAdmin, run_id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });
  const { rsvps, payments } = loaded.blockers;
  if (rsvps > 0 || payments > 0) {
    return NextResponse.json({ error: RUN_HAS_PLAYERS_MESSAGE, code: "run_has_players", rsvps, payments }, { status: 409 });
  }

  for (const table of ["pickup_run_invites", "pickup_run_time_slots", "pickup_run_availability"]) {
    const { error } = await supabaseAdmin.from(table).delete().eq("run_id", run_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { error } = await supabaseAdmin.from("pickup_runs").delete().eq("id", run_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
