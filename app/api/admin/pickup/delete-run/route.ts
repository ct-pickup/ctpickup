import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { run_id } = await req.json();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  await supabaseAdmin.from("pickup_run_rsvps").delete().eq("run_id", run_id);
  await supabaseAdmin.from("pickup_run_invites").delete().eq("run_id", run_id);
  await supabaseAdmin.from("pickup_run_time_slots").delete().eq("run_id", run_id);
  await supabaseAdmin.from("pickup_run_availability").delete().eq("run_id", run_id);
  const { error } = await supabaseAdmin.from("pickup_runs").delete().eq("id", run_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
