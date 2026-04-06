import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

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
    ? await supabaseAdmin
        .from("profiles")
        .select(
          "id,first_name,last_name,instagram,tier,plays_goalie,confirmed_count,attended_count,strike_count",
        )
        .in("id", confirmedIds)
    : { data: [] as any[] };

  const standby = standbyIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select(
          "id,first_name,last_name,instagram,tier,plays_goalie,confirmed_count,attended_count,strike_count",
        )
        .in("id", standbyIds)
    : { data: [] as any[] };

  const rosterIds = Array.from(new Set([...confirmedIds, ...standbyIds]));

  let standingRows: Record<string, unknown>[] = [];
  let waiverRows: { user_id: string }[] = [];

  if (rosterIds.length) {
    const [stRes, wRes] = await Promise.all([
      supabaseAdmin.from("pickup_player_standing").select("*").in("user_id", rosterIds),
      supabaseAdmin
        .from("user_waiver_acceptance")
        .select("user_id")
        .eq("version", CURRENT_WAIVER_VERSION)
        .in("user_id", rosterIds),
    ]);
    standingRows = (stRes.data || []) as Record<string, unknown>[];
    waiverRows = (wRes.data || []) as { user_id: string }[];
  }

  const standingBy = new Map((standingRows || []).map((s) => [s.user_id as string, s]));
  const waiverOk = new Set((waiverRows || []).map((w) => w.user_id));

  const mapRow = (r: Record<string, unknown>) => {
    const id = String(r.id || "");
    const st = standingBy.get(id) || null;
    const wOk = waiverOk.has(id);
    const eff = String(st?.effective_standing || "good");
    return {
      ...r,
      full_name:
        `${String(r.first_name || "").trim()} ${String(r.last_name || "").trim()}`.trim() || null,
      waiver_current: wOk,
      pickup_standing: st
        ? {
            effective_standing: st.effective_standing,
            auto_standing: st.auto_standing,
            manual_standing: st.manual_standing,
            pickup_eligible: st.pickup_eligible,
            auto_codes: st.auto_codes,
            rollup_no_shows_90d: st.rollup_no_shows_90d,
            rollup_late_cancels_90d: st.rollup_late_cancels_90d,
            rollup_pickup_payment_issues_90d: st.rollup_pickup_payment_issues_90d,
            staff_notes: st.staff_notes,
            manual_reason: st.manual_reason,
          }
        : null,
      join_ok: (eff === "good" || eff === "warning") && wOk,
    };
  };

  return NextResponse.json({
    run,
    current_waiver_version: CURRENT_WAIVER_VERSION,
    confirmed: (confirmed.data || []).map(mapRow),
    standby: (standby.data || []).map(mapRow),
  });
}
