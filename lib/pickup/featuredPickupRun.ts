import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { publicUpcomingRunsQuery, type PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";

export type PickupRunAccessContext = {
  userId: string | null;
  approved: boolean;
  isAdmin: boolean;
  tierRank: number | null;
};

/**
 * Load the run the hub should consider: explicit run_id, else is_current, else next upcoming (future start_at).
 * When `region` is set (NY, CT, NJ, MD), prefer that region’s promoted run; if none, fall back to a legacy
 * global promoted run (`service_region` null). There is no anonymous fallback to a different public run
 * (logged-out clients with a hub region see nothing if the promoted run is select-only).
 */
export async function fetchPickupRunCandidate(
  admin: SupabaseClient,
  opts: { runId?: string | null; region?: string | null }
): Promise<PublicPickupRunRow | null> {
  if (opts.runId) {
    const r = await admin
      .from("pickup_runs")
      .select("*")
      .eq("id", opts.runId)
      .neq("status", "canceled")
      .neq("status", "completed")
      .neq("status", "in_progress")
      .maybeSingle();
    return (r.data as PublicPickupRunRow | null) ?? null;
  }

  if (opts.region) {
    const curR = await admin
      .from("pickup_runs")
      .select("*")
      .eq("service_region", opts.region)
      .eq("is_current", true)
      .neq("status", "canceled")
      .neq("status", "completed")
      .neq("status", "in_progress")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (curR.data) return curR.data as PublicPickupRunRow;

    const legacyGlobal = await admin
      .from("pickup_runs")
      .select("*")
      .is("service_region", null)
      .eq("is_current", true)
      .neq("status", "canceled")
      .neq("status", "completed")
      .neq("status", "in_progress")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (legacyGlobal.data) return legacyGlobal.data as PublicPickupRunRow;

    return null;
  }

  const cur = await admin
    .from("pickup_runs")
    .select("*")
    .eq("is_current", true)
    .neq("status", "canceled")
    .neq("status", "completed")
    .neq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cur.data) return cur.data as PublicPickupRunRow;

  const up = await publicUpcomingRunsQuery(admin, "*")
    .neq("status", "in_progress")
    .limit(1);
  return (up.data?.[0] as PublicPickupRunRow | undefined) ?? null;
}

/** Next scheduled public run (for hub fallback when the promoted run is invite-only). */
export async function fetchFirstPublicUpcomingPickupRun(
  admin: SupabaseClient,
  serviceRegion?: string | null,
): Promise<PublicPickupRunRow | null> {
  const res = await publicUpcomingRunsQuery(admin, "*", serviceRegion ?? undefined)
    .neq("status", "completed")
    .limit(40);
  const rows = (res.data || []) as unknown as PublicPickupRunRow[];
  return rows.find((r) => isPublicPickupRunType(r.run_type)) ?? null;
}

/**
 * Latest non-canceled run in a bucket when nothing is promoted (`is_current`) or upcoming-public matched.
 * Covers: staff created a run but forgot “promote”, missing `service_region`, or start time already passed.
 */
async function fetchLatestActivePickupRunForRegionBucket(
  admin: SupabaseClient,
  regionCode: string | "global",
): Promise<PublicPickupRunRow | null> {
  let q = admin.from("pickup_runs").select("*").in("status", ["planning", "likely_on", "active", "in_progress"]);
  if (regionCode === "global") {
    q = q.is("service_region", null);
  } else {
    q = q.eq("service_region", regionCode);
  }
  const res = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (res.data as PublicPickupRunRow | null) ?? null;
}

/**
 * Whether this client may see the featured run on the hub.
 * - Public runs: visible to everyone (including logged out).
 * - Select runs: approved players only, with a row in `pickup_run_invites` for this run (invite-only).
 */
export async function userCanViewPickupRun(
  admin: SupabaseClient,
  run: PublicPickupRunRow,
  ctx: PickupRunAccessContext
): Promise<boolean> {
  if (ctx.isAdmin) return true;
  if (isPublicPickupRunType(run.run_type)) return true;
  if (!ctx.userId) return false;
  if (!ctx.approved) return false;

  const inv = await admin
    .from("pickup_run_invites")
    .select("id")
    .eq("run_id", run.id)
    .eq("user_id", ctx.userId)
    .limit(1);

  return (inv.data || []).length > 0;
}

/**
 * Latest invite for an approved player whose run is still planning or active (hub fallback when no promoted run).
 */
export async function fetchInvitedFeaturedPickupRun(
  admin: SupabaseClient,
  userId: string,
): Promise<PublicPickupRunRow | null> {
  const invRes = await admin
    .from("pickup_run_invites")
    .select("run_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (invRes.error) {
    console.error("[pickup/featured] pickup_run_invites_invited_run:", invRes.error.message, invRes.error);
    return null;
  }

  const invites = invRes.data || [];
  if (!invites.length) return null;

  const runIds = Array.from(new Set(invites.map((r) => String(r.run_id)).filter(Boolean)));
  if (!runIds.length) return null;

  const runsRes = await admin
    .from("pickup_runs")
    .select("*")
    .in("id", runIds)
    .in("status", ["planning", "active"])
    .neq("status", "canceled")
    .neq("status", "completed");

  if (runsRes.error) {
    console.error("[pickup/featured] pickup_runs_invited_run:", runsRes.error.message, runsRes.error);
    return null;
  }

  const runById = new Map<string, PublicPickupRunRow>();
  for (const row of runsRes.data || []) {
    runById.set(String(row.id), row as PublicPickupRunRow);
  }

  for (const inv of invites) {
    const match = runById.get(String(inv.run_id));
    if (match) return match;
  }

  return null;
}
