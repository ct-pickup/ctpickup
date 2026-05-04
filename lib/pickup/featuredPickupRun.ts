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
 * When `region` is set (NY, CT, NJ, MD), prefer that region’s promoted run; if none, fall back to a legacy
 * global promoted run (`service_region` null), then the next upcoming **public** run in that region.
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

    const legacyGlobal = await admin
      .from("pickup_runs")
      .select("*")
      .is("service_region", null)
      .eq("is_current", true)
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (legacyGlobal.data) return legacyGlobal.data as PublicPickupRunRow;

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

/**
 * Latest non-canceled run in a bucket when nothing is promoted (`is_current`) or upcoming-public matched.
 * Covers: staff created a run but forgot “promote”, missing `service_region`, or start time already passed.
 */
async function fetchLatestActivePickupRunForRegionBucket(
  admin: SupabaseClient,
  regionCode: string | "global",
): Promise<PublicPickupRunRow | null> {
  let q = admin.from("pickup_runs").select("*").in("status", ["planning", "likely_on", "active"]);
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
 * - Select runs: require an approved, signed-in user; missing profile tier_rank is treated as PUBLIC (rank 6),
 *   matching `/api/pickup/public` invite logic.
 * - While `open_tier_rank` is still null (planning / before tier waves), approved players can see the run exists.
 *   Once the tier window is set, select runs require an invite row as before.
 */
export async function userCanViewPickupRun(
  admin: SupabaseClient,
  run: PublicPickupRunRow,
  ctx: PickupRunAccessContext
): Promise<boolean> {
  if (ctx.isAdmin) return true;
  if (run.run_type === "public") return true;
  if (!ctx.userId) return false;

  const effectiveRank =
    ctx.tierRank === null || ctx.tierRank === undefined ? 6 : ctx.tierRank;

  const openRaw =
    run.open_tier_rank === null || run.open_tier_rank === undefined ? null : Number(run.open_tier_rank);
  // Canonical rules use null only; 0 must never mean “tier zero” (see pickup/public comments).
  const open = openRaw === null || openRaw === 0 ? null : openRaw;

  // Tier ladder not configured yet — show the hub to any signed-in player (incl. pending approval).
  if (open === null) {
    return true;
  }

  if (!ctx.approved) return false;

  if (effectiveRank > open) return false;

  const inv = await admin
    .from("pickup_run_invites")
    .select("id")
    .eq("run_id", run.id)
    .eq("user_id", ctx.userId)
    .limit(1);

  return (inv.data || []).length > 0;
}
