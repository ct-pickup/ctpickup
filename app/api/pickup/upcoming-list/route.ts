import { NextResponse } from "next/server";
import {
  publicUpcomingRunsQuery,
  type PublicPickupRunListRow,
} from "@/lib/pickup/publicUpcomingRuns";
import { jsonConfigErrorResponse, jsonUnexpectedErrorResponse } from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "pickup/upcoming-list";

function levelLabel(runType: string | null | undefined) {
  if (runType === "public") return "Open signup";
  if (runType === "select") return "Invite based";
  return "—";
}

/** GET — upcoming public pickup runs only (invite/select runs are not listed anonymously). No auth. */
export async function GET() {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const cols = "id,title,status,start_at,capacity,run_type";

    const runRes = await publicUpcomingRunsQuery(admin, cols);
    if (runRes.error) {
      console.error(`[api/${ROUTE}] publicUpcomingRunsQuery:`, runRes.error.message, runRes.error);
    }

    const fromSchedule = ((runRes.data || []) as unknown as PublicPickupRunListRow[]).filter(
      (r) => r.run_type === "public",
    );

    const curRes = await admin
      .from("pickup_runs")
      .select(cols)
      .eq("is_current", true)
      .eq("run_type", "public")
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (curRes.error) {
      console.error(`[api/${ROUTE}] current_public_run:`, curRes.error.message, curRes.error);
    }

    const byId = new Map<string, PublicPickupRunListRow>();
    for (const r of fromSchedule) byId.set(String(r.id), r);
    if (curRes.data) byId.set(String(curRes.data.id), curRes.data as PublicPickupRunListRow);

    const runs = Array.from(byId.values());
    runs.sort((a, b) => {
      if (!a.start_at && !b.start_at) return 0;
      if (!a.start_at) return 1;
      if (!b.start_at) return -1;
      return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
    });

    if (!runs.length) {
      return NextResponse.json({ runs: [] });
    }

    const ids = runs.map((r) => r.id);
    const rsvpRes = await admin
      .from("pickup_run_rsvps")
      .select("run_id,user_id,status")
      .in("run_id", ids);

    if (rsvpRes.error) {
      console.error(`[api/${ROUTE}] pickup_run_rsvps:`, rsvpRes.error.message, rsvpRes.error);
    }

    const confirmedUsersByRun = new Map<string, Set<string>>();
    for (const row of rsvpRes.data || []) {
      if (row.status !== "confirmed") continue;
      const uid = String(row.user_id);
      const rid = String(row.run_id);
      if (!confirmedUsersByRun.has(rid)) confirmedUsersByRun.set(rid, new Set());
      confirmedUsersByRun.get(rid)!.add(uid);
    }

    const payload = runs.map((r) => {
      const cap = Number(r.capacity ?? 0);
      const confirmed = confirmedUsersByRun.get(String(r.id))?.size ?? 0;
      const spotsLeft = Math.max(0, cap - confirmed);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        start_at: r.start_at,
        capacity: cap,
        run_type: r.run_type,
        level_label: levelLabel(r.run_type),
        confirmed_count: confirmed,
        spots_left: spotsLeft,
      };
    });

    return NextResponse.json({ runs: payload });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
