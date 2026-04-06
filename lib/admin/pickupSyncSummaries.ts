import type { SupabaseClient } from "@supabase/supabase-js";
import { describePickupAutoStatus } from "@/lib/pickup/autoRunCheckpoints";

export type PickupSyncSummary = {
  id: string;
  title: string;
  status: string;
  auto_managed: boolean;
  updated_at: string | null;
  next_step: string;
  checkpoints: {
    cp_24h_at: string | null;
    cp_12h_at: string | null;
    cp_6h_at: string | null;
    cp_1h_at: string | null;
  };
};

/**
 * Summarize auto-pipeline state for staff (sync / checkpoints), without mutating runs.
 */
export async function fetchPickupSyncSummaries(
  supabase: SupabaseClient,
  limit = 8
): Promise<PickupSyncSummary[]> {
  const { data: runs, error } = await supabase
    .from("pickup_runs")
    .select(
      "id,title,status,start_at,capacity,open_tier_rank,outreach_started_at,auto_managed,auto_cp_24h_at,auto_cp_12h_at,auto_cp_6h_at,auto_cp_1h_at,updated_at"
    )
    .neq("status", "canceled")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));

  if (error || !runs?.length) return [];

  const rows = await Promise.all(
    runs.map(async (run) => {
      const runId = run.id as string;
      const [slotsRes, availRes, rsvpRes] = await Promise.all([
        supabase.from("pickup_run_time_slots").select("start_at").eq("run_id", runId),
        supabase.from("pickup_run_availability").select("user_id,state,slot_id").eq("run_id", runId),
        supabase.from("pickup_run_rsvps").select("status").eq("run_id", runId),
      ]);
      const auto = describePickupAutoStatus(
        run as Record<string, unknown>,
        slotsRes.data || [],
        availRes.data || [],
        rsvpRes.data || [],
        []
      );
      const cp = auto?.checkpoints;
      return {
        id: runId,
        title: String(run.title || "Pickup run"),
        status: String(run.status || ""),
        auto_managed: !!run.auto_managed,
        updated_at: (run.updated_at as string | null | undefined) ?? null,
        next_step: auto?.next_step ?? "—",
        checkpoints: {
          cp_24h_at: (cp?.cp_24h_at as string | null | undefined) ?? null,
          cp_12h_at: (cp?.cp_12h_at as string | null | undefined) ?? null,
          cp_6h_at: (cp?.cp_6h_at as string | null | undefined) ?? null,
          cp_1h_at: (cp?.cp_1h_at as string | null | undefined) ?? null,
        },
      };
    })
  );

  return rows;
}
