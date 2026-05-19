import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import {
  currentCalendarMonthStartIsoEt,
  expiresThreeMonthsFromNowIso,
  previousCalendarMonthRangeEt,
} from "@/lib/pickup/monthlyRewardsEt";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type PodCount = { user_id: string; count: number; first_award_at: string };

/**
 * Vercel Cron: GET /api/cron/monthly-rewards
 * Schedule: 0 5 1 * * (midnight ET on the 1st ≈ 05:00 UTC).
 * Awards previous calendar month POD + attendance winners.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  const prevMonth = previousCalendarMonthRangeEt();
  const monthStartEt = currentCalendarMonthStartIsoEt();
  const expiresAt = expiresThreeMonthsFromNowIso();

  const summary: Record<string, unknown> = {
    ok: true,
    award_month: prevMonth.monthKey,
    pod: null as Record<string, unknown> | null,
    attendance: null as Record<string, unknown> | null,
  };

  // --- Player of the Month (most POD awards in previous month) ---
  const { data: podRows, error: podErr } = await admin
    .from("pickup_run_results")
    .select("player_of_day, created_at")
    .not("player_of_day", "is", null)
    .gte("created_at", prevMonth.startIso)
    .lte("created_at", prevMonth.endIso);

  if (podErr) {
    return NextResponse.json({ error: podErr.message }, { status: 500 });
  }

  const podCounts = new Map<string, PodCount>();
  for (const row of podRows || []) {
    const uid = String((row as { player_of_day: string }).player_of_day || "").trim();
    if (!uid) continue;
    const createdAt = String((row as { created_at: string }).created_at || "");
    const cur = podCounts.get(uid);
    if (!cur) {
      podCounts.set(uid, { user_id: uid, count: 1, first_award_at: createdAt });
    } else {
      cur.count += 1;
      if (createdAt && createdAt < cur.first_award_at) cur.first_award_at = createdAt;
    }
  }

  const podSorted = [...podCounts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.first_award_at.localeCompare(b.first_award_at);
  });

  if (podSorted.length > 0 && podSorted[0].count > 0) {
    const winnerId = podSorted[0].user_id;
    const { data: existingPod } = await admin
      .from("pickup_credits")
      .select("id")
      .eq("reason", "monthly_pod")
      .gte("awarded_at", monthStartEt)
      .limit(1)
      .maybeSingle();

    if (existingPod?.id) {
      summary.pod = { skipped: true, reason: "already_awarded_this_month", user_id: winnerId };
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("pickup_credits")
        .insert({
          user_id: winnerId,
          amount_cents: null,
          discount_pct: null,
          reason: "monthly_pod",
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (insErr) {
        summary.pod = { error: insErr.message };
      } else {
        await sendPushToUsers(admin, [winnerId], {
          title: "🏆 Monthly Award!",
          body: "You earned a free run for being Player of the Month! Valid 3 months.",
        });
        summary.pod = {
          awarded: true,
          user_id: winnerId,
          credit_id: inserted?.id,
          pod_count: podSorted[0].count,
        };
      }
    }
  } else {
    summary.pod = { skipped: true, reason: "no_pod_in_month" };
  }

  // --- Attendance (most confirmed RSVPs in previous month, min 4) ---
  const { data: rsvpRows, error: rsvpErr } = await admin
    .from("pickup_run_rsvps")
    .select("user_id, updated_at")
    .eq("status", "confirmed")
    .gte("updated_at", prevMonth.startIso)
    .lte("updated_at", prevMonth.endIso);

  if (rsvpErr) {
    return NextResponse.json({ error: rsvpErr.message }, { status: 500 });
  }

  const attendCounts = new Map<string, number>();
  for (const row of rsvpRows || []) {
    const uid = String((row as { user_id: string }).user_id || "").trim();
    if (!uid) continue;
    attendCounts.set(uid, (attendCounts.get(uid) ?? 0) + 1);
  }

  const attendSorted = [...attendCounts.entries()]
    .map(([user_id, count]) => ({ user_id, count }))
    .sort((a, b) => b.count - a.count);

  const topAttend = attendSorted[0];
  const MIN_ATTENDANCE = 4;

  if (!topAttend || topAttend.count < MIN_ATTENDANCE) {
    console.log("No attendance award this month - no player reached 4 runs minimum");
    summary.attendance = {
      skipped: true,
      reason: "below_minimum",
      top_count: topAttend?.count ?? 0,
    };
  } else {
    const winnerId = topAttend.user_id;
    const { data: existingAtt } = await admin
      .from("pickup_credits")
      .select("id")
      .eq("reason", "monthly_attendance")
      .gte("awarded_at", monthStartEt)
      .limit(1)
      .maybeSingle();

    if (existingAtt?.id) {
      summary.attendance = { skipped: true, reason: "already_awarded_this_month", user_id: winnerId };
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("pickup_credits")
        .insert({
          user_id: winnerId,
          amount_cents: null,
          discount_pct: 20,
          reason: "monthly_attendance",
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (insErr) {
        summary.attendance = { error: insErr.message };
      } else {
        await sendPushToUsers(admin, [winnerId], {
          title: "🏆 Monthly Award!",
          body: "You earned 20% off your next run for attending 4+ sessions this month! Valid 3 months.",
        });
        summary.attendance = {
          awarded: true,
          user_id: winnerId,
          credit_id: inserted?.id,
          run_count: topAttend.count,
        };
      }
    }
  }

  return NextResponse.json(summary);
}
