import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPickupNewRunPush } from "@/lib/pickup/pickupPushNotifications";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { loadPickupRunWaveScheduleFields } from "@/lib/pickup/pickupRunWavePostgrest";
import {
  startSelectWaveOutreachOnHubPromote,
  type PickupRunWaveRow,
} from "@/lib/pickup/waveInviteSystem";

/** Core columns for hub promote lookup (no optional wave migrations required). */
const HUB_PROMOTE_BASE_COLUMNS =
  "id,title,status,run_type,service_region,location_private,start_at,capacity,outreach_started_at";

export type HubPromoteRunMeta = {
  id: string;
  title: string;
  run_type: string;
  service_region: string | null;
  location_private: string | null;
};

export type PromotePickupRunToHubResult =
  | {
      ok: true;
      run_id: string | null;
      wave_warning: string | null;
      wave_outreach: { wave1_invited: number; next_wave_at: string | null } | null;
      promotedRun: HubPromoteRunMeta | null;
    }
  | { ok: false; error: string; status: number };

/**
 * Load a pickup run by id for hub promote. Does not filter on is_current or status
 * (except canceled is checked by the caller). Wave columns are optional so a missing
 * migration does not surface as "run not found".
 */
export async function fetchPickupRunForHubPromote(
  admin: SupabaseClient,
  runId: string,
): Promise<
  | { ok: true; row: PickupRunWaveRow; service_region: string | null }
  | { ok: false; error: string; status: number }
> {
  const runRes = await admin.from("pickup_runs").select(HUB_PROMOTE_BASE_COLUMNS).eq("id", runId).maybeSingle();

  if (runRes.error) {
    return { ok: false, error: runRes.error.message, status: 500 };
  }
  if (!runRes.data) {
    return { ok: false, error: "Run not found.", status: 404 };
  }

  const row = { ...runRes.data } as PickupRunWaveRow;
  const waveFields = await loadPickupRunWaveScheduleFields(admin, runId);
  if (!waveFields.ok) {
    return { ok: false, error: waveFields.error, status: 500 };
  }
  row.next_wave_at = waveFields.fields.next_wave_at ?? null;
  row.wave_state = waveFields.fields.wave_state ?? null;

  const service_region =
    runRes.data.service_region === null || runRes.data.service_region === undefined
      ? null
      : String(runRes.data.service_region);

  return { ok: true, row, service_region };
}

/** Clear `is_current` on other runs in the same hub region (or unscoped runs when region is null). */
export async function clearCurrentPickupRunsInRegion(
  admin: SupabaseClient,
  serviceRegion: string | null,
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const clear =
    serviceRegion !== null
      ? await admin
          .from("pickup_runs")
          .update({ is_current: false, updated_at: now })
          .eq("is_current", true)
          .eq("service_region", serviceRegion)
      : await admin
          .from("pickup_runs")
          .update({ is_current: false, updated_at: now })
          .eq("is_current", true)
          .is("service_region", null);
  return { error: clear.error?.message ?? null };
}

/** Set `is_current` for a planning (or any non-canceled) run — not gated on prior hub state. */
export async function promotePickupRunToHub(
  admin: SupabaseClient,
  runId: string | null,
): Promise<PromotePickupRunToHubResult> {
  const now = new Date().toISOString();
  let promotedRegion: string | null = null;
  let promotedRun: HubPromoteRunMeta | null = null;
  let promotedRunRow: PickupRunWaveRow | null = null;

  if (runId) {
    const loaded = await fetchPickupRunForHubPromote(admin, runId);
    if (!loaded.ok) {
      return { ok: false, error: loaded.error, status: loaded.status };
    }
    if (loaded.row.status === "canceled") {
      return { ok: false, error: "Cannot promote a canceled run.", status: 400 };
    }

    promotedRunRow = loaded.row;
    promotedRegion = loaded.service_region;
    promotedRun = {
      id: String(loaded.row.id),
      title: String(loaded.row.title || ""),
      run_type: String(loaded.row.run_type || "select"),
      service_region: promotedRegion,
      location_private:
        loaded.row.location_private === null || loaded.row.location_private === undefined
          ? null
          : String(loaded.row.location_private),
    };
  }

  if (runId) {
    const cleared = await clearCurrentPickupRunsInRegion(admin, promotedRegion);
    if (cleared.error) {
      return { ok: false, error: cleared.error, status: 500 };
    }
  } else {
    const clear = await admin.from("pickup_runs").update({ is_current: false, updated_at: now }).eq("is_current", true);
    if (clear.error) {
      return { ok: false, error: clear.error.message, status: 500 };
    }
  }

  let waveWarning: string | null = null;
  let waveOutreach: { wave1_invited: number; next_wave_at: string | null } | null = null;
  if (runId) {
    const up = await admin.from("pickup_runs").update({ is_current: true, updated_at: now }).eq("id", runId);
    if (up.error) {
      return { ok: false, error: up.error.message, status: 500 };
    }

    if (promotedRunRow) {
      const waveRes = await startSelectWaveOutreachOnHubPromote(admin, promotedRunRow);
      if (!waveRes.ok) {
        waveWarning = waveRes.error;
        console.error("[hubPromote] wave outreach failed:", waveRes.error);
      } else if (!waveRes.skipped) {
        waveOutreach = {
          wave1_invited: waveRes.wave1_invited,
          next_wave_at: waveRes.next_wave_at,
        };
      }
    }
  }

  if (promotedRun && isPublicPickupRunType(promotedRun.run_type)) {
    await sendPickupNewRunPush(admin, {
      runId: promotedRun.id,
      runTitle: promotedRun.title,
      service_region: promotedRun.service_region,
      location_private: promotedRun.location_private,
    });
  }

  return { ok: true, run_id: runId, wave_warning: waveWarning, wave_outreach: waveOutreach, promotedRun };
}
