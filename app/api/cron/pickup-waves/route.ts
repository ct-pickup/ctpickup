import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  nextWaveToSend,
  parseWaveState,
  pickupWaveCronRunColumns,
  processDueWaveForRun,
  type PickupRunWaveRow,
} from "@/lib/pickup/waveInviteSystem";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/pickup-waves (every 30 minutes).
 * Opens waves 2–4 for select runs; wave 1 fires on hub promote. See lib/pickup/waveInviteSystem.ts.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase env." }, { status: 500 });
  }

  const admin = createClient(url, key);
  const isoNow = new Date().toISOString();
  const nowMs = Date.now();

  const runsRes = await admin
    .from("pickup_runs")
    .select(pickupWaveCronRunColumns())
    .not("outreach_started_at", "is", null)
    .in("status", ["planning", "likely_on"])
    .not("next_wave_at", "is", null)
    .lte("next_wave_at", isoNow);

  if (runsRes.error) {
    return NextResponse.json({ error: runsRes.error.message }, { status: 500 });
  }

  const runs = (runsRes.data || []) as unknown as PickupRunWaveRow[];
  const results: { run_id: string; action: string; detail?: string }[] = [];

  for (const row of runs) {
    const run_id = String(row.id || "");
    if (!run_id) continue;

    const state = parseWaveState(row.wave_state);
    if (nextWaveToSend(state) === null) {
      await admin.from("pickup_runs").update({ next_wave_at: null, updated_at: isoNow }).eq("id", run_id);
      results.push({ run_id, action: "cleared_all_waves_done" });
      continue;
    }

    const result = await processDueWaveForRun(admin, row, nowMs);
    if (result) results.push(result);
  }

  return NextResponse.json({ ok: true, processed: runs.length, results });
}
