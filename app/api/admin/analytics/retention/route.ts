import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { buildRetentionReport } from "@/lib/analytics/report";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_READY = /does not exist|could not find the table|schema cache|42P01|PGRST205/i;

/**
 * GET /api/admin/analytics/retention (admins only)
 * The funnel, the 30 day second-game rate by week, the cohort heatmap, run health by region and notification effectiveness,
 * read from the metrics views. If the analytics migrations are not applied yet it answers { ready: false } instead of failing.
 */
export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;
  const svc = supabaseService();

  const [funnel, second, cohorts, health, notes] = await Promise.all([
    svc.from("analytics_first_game_funnel").select("*"),
    svc.from("analytics_second_game_30d").select("*").order("cohort_week", { ascending: true }).limit(26),
    svc.from("analytics_retention_cohorts").select("*").order("cohort_week", { ascending: false }).limit(12 * 9),
    svc.from("analytics_run_health_by_region").select("*"),
    svc.from("analytics_notification_effectiveness").select("*"),
  ]);

  const failed = [funnel, second, cohorts, health, notes].find((r) => r.error);
  if (failed?.error) {
    if (NOT_READY.test(`${failed.error.code ?? ""} ${failed.error.message ?? ""}`)) return NextResponse.json({ ok: true, ready: false });
    console.error("[admin/analytics/retention]", failed.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const report = buildRetentionReport({
    funnel: funnel.data,
    second_game: second.data,
    cohorts: cohorts.data,
    run_health: health.data,
    notifications: notes.data,
  });
  return NextResponse.json({ ok: true, ready: true, report });
}
