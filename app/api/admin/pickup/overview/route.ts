import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const runRes = await supabaseAdmin
    .from("pickup_runs")
    .select("*")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  const run = runRes.data?.[0] || null;
  if (!run) return NextResponse.json({ run: null, confirmed: [], standby: [] });

  const rsvps = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("user_id,status,paid_at")
    .eq("run_id", run.id);

  const confirmedIds = (rsvps.data || []).filter(r => r.status === "confirmed").map(r => r.user_id);
  const standbyIds = (rsvps.data || []).filter(r => r.status === "standby").map(r => r.user_id);

  const confirmed = confirmedIds.length
    ? await supabaseAdmin.from("profiles").select("id,full_name,instagram,tier,confirmed_count,attended_count,strike_count").in("id", confirmedIds)
    : { data: [] as any[] };

  const standby = standbyIds.length
    ? await supabaseAdmin.from("profiles").select("id,full_name,instagram,tier,confirmed_count,attended_count,strike_count").in("id", standbyIds)
    : { data: [] as any[] };

  return NextResponse.json({
    run,
    confirmed: confirmed.data || [],
    standby: standby.data || [],
  });
}
