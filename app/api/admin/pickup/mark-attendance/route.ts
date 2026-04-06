import { NextResponse } from "next/server";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
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

  const { run_id, attendance } = await req.json(); // attendance: [{user_id, attended}]
  if (!run_id || !Array.isArray(attendance)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Upsert attendance + reliability incidents (no-shows) for standing
  for (const a of attendance) {
    await supabaseAdmin
      .from("pickup_run_attendance")
      .upsert({
        run_id,
        user_id: a.user_id,
        attended: !!a.attended,
        marked_by: user.id,
        marked_at: new Date().toISOString(),
      }, { onConflict: "run_id,user_id" });

    if (a.attended) {
      await supabaseAdmin
        .from("pickup_reliability_incidents")
        .delete()
        .eq("run_id", run_id)
        .eq("user_id", a.user_id)
        .eq("kind", "no_show");
    } else {
      const ins = await supabaseAdmin.from("pickup_reliability_incidents").insert({
        run_id,
        user_id: a.user_id,
        kind: "no_show",
        source: "attendance",
      });
      if (ins.error && ins.error.code !== "23505") {
        console.error("[mark-attendance] incident:", ins.error.message);
      }
    }
  }

  // Recompute stats for affected users
  const userIds = listUnique(attendance.map((a: any) => a.user_id));

  for (const uid of userIds) {
    const rows = await supabaseAdmin
      .from("pickup_run_attendance")
      .select("attended")
      .eq("user_id", uid);

    const total = (rows.data || []).length;
    const attended = (rows.data || []).filter((r) => r.attended).length;
    const missed = total - attended;

    await supabaseAdmin
      .from("profiles")
      .update({
        confirmed_count: total,
        attended_count: attended,
        strike_count: missed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", uid);
  }

  for (const uid of userIds) {
    try {
      await recomputePickupStandingForUser(supabaseAdmin, uid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[mark-attendance] standing recompute:", msg);
    }
  }

  return NextResponse.json({ ok: true });
}

function listUnique(xs: string[]) {
  return Array.from(new Set(xs.filter(Boolean)));
}
