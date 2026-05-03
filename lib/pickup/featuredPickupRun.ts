import type { SupabaseClient } from "@supabase/supabase-js";
import { publicUpcomingRunsQuery, type PublicPickupRunRow } from "@/lib/pickup/publicUpcomingRuns";

export type PickupRunAccessContext = {
  userId: string | null;
  approved: boolean;
  isAdmin: boolean;
  tierRank: number | null;
};

/**
 * Load the run the hub should consider: explicit run_id, else is_current, else next upcoming (future start_at).
 * When `region` is set (NY, CT, NJ, MD), only runs tagged with that `service_region` are considered.
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
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (curR.data) return curR.data as PublicPickupRunRow;

    return fetchFirstPublicUpcomingPickupRun(admin, opts.region);
  }

  const cur = await admin
    .from("pickup_runs")
    .select("*")
    .eq("is_current", true)
    .neq("status", "canceled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cur.data) return cur.data as PublicPickupRunRow;

  const up = await publicUpcomingRunsQuery(admin, "*").limit(1);
  return (up.data?.[0] as PublicPickupRunRow | undefined) ?? null;
}

/** Next scheduled public run (for hub fallback when the promoted run is invite-only). */
export async function fetchFirstPublicUpcomingPickupRun(
  admin: SupabaseClient,
  serviceRegion?: string | null,
): Promise<PublicPickupRunRow | null> {
  const res = await publicUpcomingRunsQuery(admin, "*", serviceRegion ?? undefined).limit(40);
  const rows = (res.data || []) as unknown as PublicPickupRunRow[];
  return rows.find((r) => r.run_type === "public") ?? null;
}

/** Whether this client may see run details (select runs are restricted). */
export async function userCanViewPickupRun(
  admin: SupabaseClient,
  run: PublicPickupRunRow,
  ctx: PickupRunAccessContext
): Promise<boolean> {
  if (ctx.isAdmin) return true;
  if (run.run_type === "public") return true;
  if (!ctx.userId || !ctx.approved || ctx.tierRank === null) return false;

  const open =
    run.open_tier_rank === null || run.open_tier_rank === undefined
      ? null
      : Number(run.open_tier_rank);
  if (open === null || ctx.tierRank > open) return false;

  const inv = await admin
    .from("pickup_run_invites")
    .select("id")
    .eq("run_id", run.id)
    .eq("user_id", ctx.userId)
    .limit(1);

  return (inv.data || []).length > 0;
}
