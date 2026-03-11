import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { run_id, promote_user_id } = await req.json();

  const runRes = await supabaseAdmin.from("pickup_runs").select("*").eq("id", run_id).single();
  if (runRes.error) return NextResponse.json({ error: runRes.error.message }, { status: 500 });
  const run = runRes.data;

  const countRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .eq("status", "confirmed");

  const confirmedCount = countRes.count || 0;
  if (confirmedCount >= Number(run.capacity || 0)) {
    return NextResponse.json({ error: "Run is already at capacity." }, { status: 409 });
  }

  const newStatus = Number(run.fee_cents || 0) > 0 ? "pending_payment" : "confirmed";

  const up = await supabaseAdmin
    .from("pickup_run_rsvps")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("run_id", run_id)
    .eq("user_id", promote_user_id);

  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: newStatus });
}
