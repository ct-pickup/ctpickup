import { NextResponse } from "next/server";
import {
  currentCalendarMonthRangeEt,
  currentCalendarMonthStartIsoEt,
  previousCalendarMonthRangeEt,
} from "@/lib/pickup/monthlyRewardsEt";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaderRow = { user_id: string; count: number; name: string };

function displayName(p: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  const first = String(p.first_name || "").trim();
  const last = String(p.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const user = String(p.username || "").trim();
  if (user) return `@${user.replace(/^@/, "")}`;
  return "Player";
}

async function profileNames(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;

  const { data } = await admin
    .from("profiles")
    .select("id,first_name,last_name,username")
    .in("id", ids);

  for (const p of data || []) {
    map.set(String(p.id), displayName(p));
  }
  return map;
}

function topPodFromResults(
  rows: { player_of_day: string | null; created_at: string }[],
  limit: number,
): { user_id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const uid = String(row.player_of_day || "").trim();
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([user_id, count]) => ({ user_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function topAttendanceFromRsvps(
  rows: { user_id: string }[],
  limit: number,
): { user_id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const uid = String(row.user_id || "").trim();
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([user_id, count]) => ({ user_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function toLeaderRows(
  admin: ReturnType<typeof getSupabaseAdmin>,
  ranked: { user_id: string; count: number }[],
): Promise<LeaderRow[]> {
  const names = await profileNames(
    admin,
    ranked.map((r) => r.user_id),
  );
  return ranked.map((r) => ({
    user_id: r.user_id,
    count: r.count,
    name: names.get(r.user_id) ?? "Player",
  }));
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const thisMonth = currentCalendarMonthRangeEt();
  const prevMonth = previousCalendarMonthRangeEt();
  const monthStartEt = currentCalendarMonthStartIsoEt();

  const [podRes, rsvpRes, winnersRes] = await Promise.all([
    admin
      .from("pickup_run_results")
      .select("player_of_day, created_at")
      .not("player_of_day", "is", null)
      .gte("created_at", thisMonth.startIso)
      .lte("created_at", thisMonth.endIso),
    admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("status", "confirmed")
      .gte("updated_at", thisMonth.startIso)
      .lte("updated_at", thisMonth.endIso),
    admin
      .from("pickup_credits")
      .select("id,user_id,reason,discount_pct,awarded_at")
      .in("reason", ["monthly_pod", "monthly_attendance"])
      .gte("awarded_at", monthStartEt),
  ]);

  if (podRes.error) return NextResponse.json({ error: podRes.error.message }, { status: 500 });
  if (rsvpRes.error) return NextResponse.json({ error: rsvpRes.error.message }, { status: 500 });
  if (winnersRes.error) return NextResponse.json({ error: winnersRes.error.message }, { status: 500 });

  const podTop = await toLeaderRows(admin, topPodFromResults(podRes.data || [], 3));
  const attendanceTop = await toLeaderRows(admin, topAttendanceFromRsvps(rsvpRes.data || [], 3));

  const winnerIds = (winnersRes.data || []).map((w) => String((w as { user_id: string }).user_id));
  const winnerNames = await profileNames(admin, winnerIds);

  const lastMonthWinners = (winnersRes.data || []).map((w) => {
    const row = w as {
      user_id: string;
      reason: string;
      discount_pct: number | null;
    };
    return {
      user_id: row.user_id,
      reason: row.reason,
      name: winnerNames.get(row.user_id) ?? "Player",
      discount_pct: row.discount_pct,
    };
  });

  return NextResponse.json({
    month_key: thisMonth.monthKey,
    previous_month_key: prevMonth.monthKey,
    pod_top: podTop,
    attendance_top: attendanceTop,
    last_month_winners: lastMonthWinners,
  });
}
