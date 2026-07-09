import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingProfileColumnError } from "@/lib/profileLoad";

export type PickupRunWaveScheduleFields = {
  next_wave_at?: string | null;
  wave_state?: unknown;
  current_wave?: number | null;
  outreach_started_at?: string | null;
};

export type PickupRunWaveSchedulePatch = {
  run_id: string;
  updated_at: string;
  open_tier_rank: number;
  current_wave: number;
  next_wave_at: string | null;
  wave_state: Record<string, unknown>;
  outreach_started_at?: string;
  wave1_started_at?: string;
  auto_managed?: boolean;
};

/** PostgREST schema cache miss for a pickup_runs wave column (column may exist in Postgres). */
export function isPickupRunWaveColumnSchemaError(message: string | null | undefined): boolean {
  return isMissingProfileColumnError(message);
}

function waveScheduleRpcPayload(patch: PickupRunWaveSchedulePatch) {
  return {
    p_run_id: patch.run_id,
    p_updated_at: patch.updated_at,
    p_open_tier_rank: patch.open_tier_rank,
    p_current_wave: patch.current_wave,
    p_next_wave_at: patch.next_wave_at,
    p_wave_state: patch.wave_state,
    p_outreach_started_at: patch.outreach_started_at ?? null,
    p_wave1_started_at: patch.wave1_started_at ?? null,
    p_auto_managed: patch.auto_managed ?? null,
  };
}

/**
 * Persist wave scheduling fields after a wave fires. Falls back to SQL RPC when PostgREST
 * does not yet know columns such as `current_wave`.
 */
export async function updatePickupRunWaveSchedule(
  admin: SupabaseClient,
  patch: PickupRunWaveSchedulePatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientPatch: Record<string, unknown> = {
    open_tier_rank: patch.open_tier_rank,
    current_wave: patch.current_wave,
    next_wave_at: patch.next_wave_at,
    wave_state: patch.wave_state,
    updated_at: patch.updated_at,
  };
  if (patch.outreach_started_at != null) {
    clientPatch.outreach_started_at = patch.outreach_started_at;
    clientPatch.wave1_started_at = patch.wave1_started_at ?? patch.outreach_started_at;
    clientPatch.auto_managed = patch.auto_managed ?? true;
  }

  const up = await admin.from("pickup_runs").update(clientPatch).eq("id", patch.run_id);
  if (!up.error) return { ok: true };
  if (!isPickupRunWaveColumnSchemaError(up.error.message)) {
    return { ok: false, error: up.error.message };
  }

  const rpc = await admin.rpc("update_pickup_run_wave_schedule", waveScheduleRpcPayload(patch));
  if (rpc.error) {
    return {
      ok: false,
      error: `${rpc.error.message} Apply migration supabase/migrations/20260526120000_pickup_run_wave_schedule_rpc.sql, then retry.`,
    };
  }
  return { ok: true };
}

/**
 * Load wave scheduling fields for one run. Uses RPC when PostgREST select fails on wave columns.
 */
export async function loadPickupRunWaveScheduleFields(
  admin: SupabaseClient,
  runId: string,
  columns = "next_wave_at,wave_state",
): Promise<{ ok: true; fields: PickupRunWaveScheduleFields } | { ok: false; error: string }> {
  const res = await admin.from("pickup_runs").select(columns).eq("id", runId).maybeSingle();
  if (!res.error) {
    return { ok: true, fields: (res.data ?? {}) as PickupRunWaveScheduleFields };
  }
  if (!isPickupRunWaveColumnSchemaError(res.error.message)) {
    return { ok: false, error: res.error.message };
  }

  const rpc = await admin.rpc("get_pickup_run_wave_schedule", { p_run_id: runId });
  if (rpc.error) {
    return {
      ok: false,
      error: `${rpc.error.message} Apply migration supabase/migrations/20260526120000_pickup_run_wave_schedule_rpc.sql, then retry.`,
    };
  }

  const raw = rpc.data;
  if (!raw || typeof raw !== "object") {
    return { ok: true, fields: {} };
  }
  return { ok: true, fields: raw as PickupRunWaveScheduleFields };
}
