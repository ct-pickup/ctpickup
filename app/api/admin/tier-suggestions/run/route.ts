import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export const runtime = "nodejs";

const LOOKBACK_DAYS = 30;

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 864e5).toISOString();
}

function tierLabelFromRank(rank: number): string {
  if (rank <= 1) return "Tier 1A";
  if (rank === 2) return "Tier 1B";
  if (rank === 3) return "Tier 2";
  if (rank === 4) return "Tier 3";
  if (rank === 5) return "Tier 4";
  return "Public";
}

function suggestedRankFromCurrent(rank: number): number {
  const r = Math.max(1, Math.floor(rank || 6));
  return Math.max(1, r - 1);
}

export async function POST(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const svc = supabaseService();
  const since = sinceIso(LOOKBACK_DAYS);

  // Attendance window: use marked_at if present; else fallback to created_at.
  const attRes = await svc
    .from("pickup_run_attendance")
    .select("user_id,attended,marked_at")
    .gte("marked_at", since);

  if (attRes.error) {
    console.error("[admin/tier-suggestions/run] attendance:", attRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const byUser = new Map<string, { total: number; attended: number }>();
  for (const row of attRes.data || []) {
    const uid = String((row as any).user_id || "");
    if (!uid) continue;
    const cur = byUser.get(uid) || { total: 0, attended: 0 };
    cur.total += 1;
    if ((row as any).attended) cur.attended += 1;
    byUser.set(uid, cur);
  }

  const candidateIds = Array.from(byUser.entries())
    .filter(([, v]) => v.total >= 5 && v.attended / v.total >= 0.9)
    .map(([uid]) => uid);

  if (candidateIds.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, candidates: 0 });
  }

  // Exclude anyone with late cancels in window.
  const lateRes = await svc
    .from("pickup_reliability_incidents")
    .select("user_id,created_at")
    .eq("kind", "late_cancel")
    .gte("created_at", since)
    .in("user_id", candidateIds);

  if (lateRes.error) {
    console.error("[admin/tier-suggestions/run] late_cancel incidents:", lateRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const lateSet = new Set((lateRes.data || []).map((r: any) => String(r.user_id)));

  // Capture no_show counts (window) for display, but do not block promotions on them beyond attendance threshold.
  const noShowRes = await svc
    .from("pickup_reliability_incidents")
    .select("user_id,created_at")
    .eq("kind", "no_show")
    .gte("created_at", since)
    .in("user_id", candidateIds);

  if (noShowRes.error) {
    console.error("[admin/tier-suggestions/run] no_show incidents:", noShowRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const noShowMap = new Map<string, number>();
  for (const r of noShowRes.data || []) {
    const uid = String((r as any).user_id);
    noShowMap.set(uid, (noShowMap.get(uid) || 0) + 1);
  }

  const eligibleIds = candidateIds.filter((id) => !lateSet.has(id));

  const profRes = await svc
    .from("profiles")
    .select("id,approved,tier,tier_rank,is_admin")
    .in("id", eligibleIds);

  if (profRes.error) {
    console.error("[admin/tier-suggestions/run] profiles:", profRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const profs = (profRes.data || []).filter((p: any) => p.approved === true);

  // Avoid inserting duplicates: skip users who already have a pending suggestion.
  const pendingRes = await svc
    .from("tier_promotion_suggestions")
    .select("user_id")
    .eq("reviewed", false)
    .in(
      "user_id",
      profs.map((p: any) => String(p.id)),
    );

  if (pendingRes.error) {
    console.error("[admin/tier-suggestions/run] pending suggestions:", pendingRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const pendingSet = new Set((pendingRes.data || []).map((r: any) => String(r.user_id)));

  const nowIso = new Date().toISOString();
  const inserts = profs
    .map((p: any) => {
      const uid = String(p.id);
      if (pendingSet.has(uid)) return null;
      const stats = byUser.get(uid);
      if (!stats) return null;
      const currentRank = Number(p.tier_rank ?? 6);
      const suggestedRank = suggestedRankFromCurrent(currentRank);
      const suggestedTier = tierLabelFromRank(suggestedRank);
      const rate = stats.total > 0 ? stats.attended / stats.total : 0;
      const reason = `${stats.attended} runs attended, ${(rate * 100).toFixed(0)}% attendance, 0 late cancels`;
      return {
        user_id: uid,
        current_tier: p.tier ?? tierLabelFromRank(currentRank),
        suggested_tier: suggestedTier,
        reason,
        runs_attended: stats.attended,
        attendance_rate: rate,
        no_show_count: noShowMap.get(uid) || 0,
        created_at: nowIso,
      };
    })
    .filter(Boolean) as any[];

  if (inserts.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, candidates: eligibleIds.length });
  }

  const ins = await svc.from("tier_promotion_suggestions").insert(inserts);
  if (ins.error) {
    console.error("[admin/tier-suggestions/run] insert:", ins.error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // Notify admins
  const adminIdsRes = await svc.from("profiles").select("id").eq("is_admin", true);
  const adminIds = (adminIdsRes.data || []).map((r: any) => String(r.id)).filter(Boolean);
  if (adminIds.length) {
    await sendPushToUsers(svc, adminIds, {
      title: "Tier review",
      body: `${inserts.length} players ready for tier review`,
      data: { kind: "tier_suggestions_ready" },
    });
  }

  return NextResponse.json({ ok: true, inserted: inserts.length, candidates: eligibleIds.length });
}

