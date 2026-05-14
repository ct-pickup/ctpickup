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

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("pickup_runs")
    .select("start_at")
    .eq("id", run_id)
    .maybeSingle();

  if (runErr || !runRow) {
    console.error("[mark-attendance] run lookup:", runErr?.message ?? "missing");
    return NextResponse.json({ error: "Run not found" }, { status: 400 });
  }

  const runStartAtRaw = runRow.start_at != null ? String(runRow.start_at) : "";
  const runStartMs = runStartAtRaw ? Date.parse(runStartAtRaw) : NaN;
  const streakEnabled = Number.isFinite(runStartMs);
  if (!streakEnabled) {
    console.warn("[mark-attendance] skipping streak: invalid or missing start_at for run", run_id);
  }
  const runStartAt = streakEnabled ? new Date(runStartMs).toISOString() : "";

  const userIds = listUnique(
    attendance.map((a: { user_id?: string }) => a.user_id).filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const priorAttendedByUser = new Map<string, boolean>();
  if (userIds.length) {
    const { data: priorRows } = await supabaseAdmin
      .from("pickup_run_attendance")
      .select("user_id, attended")
      .eq("run_id", run_id)
      .in("user_id", userIds);
    for (const row of priorRows || []) {
      const uid = typeof row.user_id === "string" ? row.user_id : "";
      if (uid) priorAttendedByUser.set(uid, !!row.attended);
    }
  }

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

  const markingByUser = new Map<string, boolean>();
  for (const a of attendance as { user_id?: string; attended?: boolean }[]) {
    const uid = typeof a.user_id === "string" ? a.user_id : "";
    if (!uid) continue;
    markingByUser.set(uid, !!a.attended);
  }

  const MS_PER_DAY = 86_400_000;
  const STREAK_GAP_DAYS = 30;

  for (const [uid, attended] of markingByUser) {
    if (!attended) {
      await supabaseAdmin
        .from("profiles")
        .update({ current_streak: 0, updated_at: new Date().toISOString() })
        .eq("id", uid);
      continue;
    }

    if (!streakEnabled) continue;

    if (priorAttendedByUser.get(uid) === true) continue;

    const profRow = await supabaseAdmin
      .from("profiles")
      .select("current_streak, longest_streak, last_streak_run_at")
      .eq("id", uid)
      .maybeSingle();

    if (profRow.error || !profRow.data) {
      console.error("[mark-attendance] streak profile:", profRow.error?.message);
      continue;
    }

    const currentStreak = Math.max(0, Math.trunc(Number(profRow.data.current_streak ?? 0)));
    const longestStreak = Math.max(0, Math.trunc(Number(profRow.data.longest_streak ?? 0)));
    const lastRaw = profRow.data.last_streak_run_at;
    const lastMs = lastRaw != null ? Date.parse(String(lastRaw)) : NaN;

    let newStreak: number;
    if (lastRaw == null || !Number.isFinite(lastMs)) {
      newStreak = currentStreak + 1;
    } else {
      const gapDays = (runStartMs - lastMs) / MS_PER_DAY;
      if (gapDays > STREAK_GAP_DAYS || gapDays < 0) newStreak = 1;
      else newStreak = currentStreak + 1;
    }

    const newLongest = Math.max(longestStreak, newStreak);

    await supabaseAdmin
      .from("profiles")
      .update({
        current_streak: newStreak,
        longest_streak: newLongest,
        last_streak_run_at: runStartAt,
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
