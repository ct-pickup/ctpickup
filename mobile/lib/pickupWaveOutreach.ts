import { isPublicPickupRunType } from "@/lib/pickupRunType";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

type WaveStateSlice = {
  wave1_sent_at?: string | null;
  wave2_sent_at?: string | null;
  wave3_sent_at?: string | null;
  wave4_sent_at?: string | null;
};

function parseWaveState(raw: unknown): WaveStateSlice {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const pickStr = (k: string) => {
    const v = o[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  return {
    wave1_sent_at: pickStr("wave1_sent_at"),
    wave2_sent_at: pickStr("wave2_sent_at"),
    wave3_sent_at: pickStr("wave3_sent_at"),
    wave4_sent_at: pickStr("wave4_sent_at"),
  };
}

function nextWaveToSend(state: WaveStateSlice): number | null {
  if (!state.wave1_sent_at) return 1;
  if (!state.wave2_sent_at) return 2;
  if (!state.wave3_sent_at) return 3;
  if (!state.wave4_sent_at) return 4;
  return null;
}

export function outreachWaveTierLabel(wave: number): string {
  return wave === 1 ? "Tier 1" : `Tier ${wave}`;
}

/** When admin can skip ahead to the next outreach wave (waves 2–4 only). */
export function skipWaveUiForRun(
  run: Record<string, unknown>,
): { nextWave: number; tierLabel: string } | null {
  if (isPublicPickupRunType(run.run_type)) return null;
  if (!s(run.outreach_started_at)) return null;
  if (!run.wave_state || typeof run.wave_state !== "object") return null;

  const state = parseWaveState(run.wave_state);
  if (!state.wave1_sent_at) return null;

  const nextWave = nextWaveToSend(state);
  if (nextWave === null || nextWave === 1) return null;

  return { nextWave, tierLabel: outreachWaveTierLabel(nextWave) };
}
