import type { SupabaseClient } from "@supabase/supabase-js";

/** Row shape used by /api/pickup/public (select("*")). */
export type PublicPickupRunRow = {
  id: string;
  title: string | null;
  status: string;
  start_at: string | null;
  run_type: string | null;
  capacity: number | null;
  fee_cents: number | null;
  currency: string | null;
  cancellation_deadline: string | null;
  location_private: string | null;
  open_tier_rank: number | null;
  wave1_started_at: string | null;
  likely_on_at: string | null;
  likely_on_slot_id: string | null;
  final_slot_id: string | null;
  /** Promoted run for the pickup hub (only one should be true at a time). */
  is_current?: boolean | null;
  /** NY · CT · NJ · MD — regional featured run; null = legacy / global hub row */
  service_region?: string | null;
};

/** Subset returned by /api/pickup/upcoming-list query. */
export type PublicPickupRunListRow = Pick<
  PublicPickupRunRow,
  "id" | "title" | "status" | "start_at" | "capacity" | "run_type"
>;

/**
 * Canonical filters for public pickup UIs (same rules as /api/pickup/public):
 * non-canceled runs with a scheduled start_at in the future.
 */
export function publicUpcomingRunsQuery(admin: SupabaseClient, columns: string, serviceRegion?: string | null) {
  let q = admin
    .from("pickup_runs")
    .select(columns)
    .neq("status", "canceled")
    .not("start_at", "is", null)
    .gte("start_at", new Date().toISOString());
  if (serviceRegion) {
    q = q.eq("service_region", serviceRegion);
  }
  return q.order("start_at", { ascending: true });
}
