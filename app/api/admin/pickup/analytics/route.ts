import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";
import { computePickupReliability } from "@/lib/pickup/standing/reliabilityScore";

export const runtime = "nodejs";

const LOOKBACK_DAYS = 30;
const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 864e5).toISOString();
}

function regionOrNull(raw: string | null): string | null {
  const v = String(raw || "").trim().toUpperCase();
  return v && HUB_REGIONS.has(v) ? v : null;
}

type RegionStats = {
  region: string;
  runs_created: number;
  avg_attendance: number | null;
  rsvp_to_attended_pct: number | null;
  no_show_rate_pct: number | null;
  late_cancel_rate_pct: number | null;
};

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const region = regionOrNull(url.searchParams.get("region"));

  const svc = supabaseService();
  const since = sinceIso(LOOKBACK_DAYS);

  let runsQuery = svc
    .from("pickup_runs")
    .select("id,service_region,created_at,status")
    .gte("created_at", since)
    .neq("status", "canceled");

  if (region) runsQuery = runsQuery.eq("service_region", region);

  const runsRes = await runsQuery;
  if (runsRes.error) {
    console.error("[admin/pickup/analytics] runs:", runsRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const runs = (runsRes.data || []) as { id: string; service_region: string | null }[];
  const runIds = runs.map((r) => String(r.id));

  const byRegion = new Map<string, { runIds: string[]; runs_created: number }>();
  for (const r of runs) {
    const reg = (r.service_region ? String(r.service_region).trim().toUpperCase() : "") || "—";
    const cur = byRegion.get(reg) || { runIds: [], runs_created: 0 };
    cur.runIds.push(String(r.id));
    cur.runs_created += 1;
    byRegion.set(reg, cur);
  }

  // Attendance rows (run_id, attended)
  const attRes = runIds.length
    ? await svc
        .from("pickup_run_attendance")
        .select("run_id,attended")
        .in("run_id", runIds)
    : { data: [] as { run_id: string; attended: boolean }[], error: null as any };

  if ((attRes as any).error) {
    console.error("[admin/pickup/analytics] attendance:", (attRes as any).error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const attRows = ((attRes as any).data || []) as { run_id: string; attended: boolean }[];

  // Incidents in window for these runs
  const incRes = runIds.length
    ? await svc
        .from("pickup_reliability_incidents")
        .select("run_id,kind,created_at")
        .gte("created_at", since)
        .in("run_id", runIds)
    : { data: [] as { run_id: string; kind: string }[], error: null as any };

  if ((incRes as any).error) {
    console.error("[admin/pickup/analytics] incidents:", (incRes as any).error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const incRows = ((incRes as any).data || []) as { run_id: string; kind: string }[];

  function statsFor(runIdsForRegion: string[]): Omit<RegionStats, "region" | "runs_created"> {
    const runSet = new Set(runIdsForRegion);
    const att = attRows.filter((r) => runSet.has(String(r.run_id)));
    const attended = att.filter((r) => r.attended).length;
    const tracked = att.length; // proxy for "RSVPed" when attendance was recorded

    const byRunAttended = new Map<string, number>();
    for (const r of att) {
      if (!r.attended) continue;
      const k = String(r.run_id);
      byRunAttended.set(k, (byRunAttended.get(k) || 0) + 1);
    }

    const totalAttendedAcrossRuns = Array.from(byRunAttended.values()).reduce((a, b) => a + b, 0);
    const avgAttendance =
      runIdsForRegion.length > 0 ? Math.round((totalAttendedAcrossRuns / runIdsForRegion.length) * 10) / 10 : null;

    const inc = incRows.filter((r) => runSet.has(String(r.run_id)));
    const lateCancels = inc.filter((r) => r.kind === "late_cancel").length;
    const noShows = inc.filter((r) => r.kind === "no_show").length;

    const rsvpToAttended = tracked > 0 ? Math.round(((attended / tracked) * 100) * 10) / 10 : null;
    const noShowRate = tracked > 0 ? Math.round(((noShows / tracked) * 100) * 10) / 10 : null;
    const lateCancelRate = tracked > 0 ? Math.round(((lateCancels / tracked) * 100) * 10) / 10 : null;

    return {
      avg_attendance: avgAttendance,
      rsvp_to_attended_pct: rsvpToAttended,
      no_show_rate_pct: noShowRate,
      late_cancel_rate_pct: lateCancelRate,
    };
  }

  const regionBreakdown: RegionStats[] = Array.from(byRegion.entries()).map(([reg, meta]) => ({
    region: reg,
    runs_created: meta.runs_created,
    ...statsFor(meta.runIds),
  }));

  // Overall stats (across selected region or all)
  const overall = {
    lookback_days: LOOKBACK_DAYS,
    total_runs_created: runs.length,
    ...statsFor(runIds),
  };

  // Reliability leaderboard (lifetime-ish, uses cached profile counters + incidents).
  const profRes = await svc
    .from("profiles")
    .select("id,first_name,last_name,approved,confirmed_count,attended_count,strike_count")
    .eq("approved", true)
    .limit(2500);

  if (profRes.error) {
    console.error("[admin/pickup/analytics] profiles:", profRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const profiles = (profRes.data || []) as any[];
  const userIds = profiles.map((p) => String(p.id));

  const lateMap = await (async () => {
    const { data, error } = await svc
      .from("pickup_reliability_incidents")
      .select("user_id")
      .eq("kind", "late_cancel")
      .in("user_id", userIds);
    if (error) {
      console.error("[admin/pickup/analytics] late_cancel map:", error.message);
      return new Map<string, number>();
    }
    const m = new Map<string, number>();
    for (const r of data || []) {
      const uid = String((r as any).user_id);
      m.set(uid, (m.get(uid) || 0) + 1);
    }
    return m;
  })();

  const leaderboard = profiles
    .map((p) => {
      const confirmed = Number(p.confirmed_count || 0);
      const attended = Number(p.attended_count || 0);
      const noShows = Number(p.strike_count || 0);
      const lateCancels = lateMap.get(String(p.id)) || 0;
      const rel = computePickupReliability({ confirmed, attended, lateCancels, noShows });
      const name = `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim() || "Player";
      return {
        user_id: String(p.id),
        full_name: name,
        tracked_pickups: rel.trackedPickups,
        reliability_score_pct: rel.scorePct,
        no_show_count: noShows,
        late_cancel_count: lateCancels,
      };
    })
    .filter((r) => r.tracked_pickups >= 3 && r.reliability_score_pct != null);

  leaderboard.sort((a, b) => (b.reliability_score_pct! - a.reliability_score_pct!));
  const top_reliable = leaderboard.slice(0, 10);
  const bottom_reliable = [...leaderboard].sort((a, b) => (a.reliability_score_pct! - b.reliability_score_pct!)).slice(0, 10);

  return NextResponse.json({
    ok: true,
    overall,
    per_region: regionBreakdown.sort((a, b) => a.region.localeCompare(b.region)),
    top_reliable,
    bottom_reliable,
  });
}

