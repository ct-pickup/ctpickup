import type { SupabaseClient } from "@supabase/supabase-js";
import { findRunBanterRoom } from "@/lib/chat/runBanterRoom";
import { insertInvitesForTierRanks, type InvitePlayer } from "@/lib/pickup/pickupInvites";
import {
  sendPickupInvitePush,
  sendPickupPriorWaveReinvitePush,
} from "@/lib/pickup/pickupPushNotifications";
import { isSelectPickupRunType } from "@/lib/pickup/pickupRunType";
import { anchorStartAtMs } from "@/lib/pickup/runScheduling";

/** Hours before kickoff when wave 4 (emergency tiers) opens. */
export const WAVE_4_HOURS_BEFORE_KICKOFF = 2;

export type PickupWaveNumber = 1 | 2 | 3 | 4;

export type PickupWaveState = {
  wave1_sent_at?: string | null;
  wave2_sent_at?: string | null;
  wave3_sent_at?: string | null;
  wave4_sent_at?: string | null;
  w1_to_w2_hours?: number | null;
  w2_to_w3_hours?: number | null;
  /** Hours until kickoff when wave 1 fired; used for base W1→W2 / W2→W3 intervals. */
  hours_until_at_promote?: number | null;
};

export type PickupRunWaveRow = {
  id: string;
  title?: string | null;
  status?: string | null;
  start_at?: string | null;
  capacity?: number | null;
  run_type?: string | null;
  service_region?: string | null;
  outreach_started_at?: string | null;
  next_wave_at?: string | null;
  open_tier_rank?: number | null;
  current_wave?: number | null;
  wave_state?: unknown;
};

const MS_PER_HOUR = 3600000;

/** Wave → profile tier_rank values (1a/1b, 2, 3, 4+5 emergency). */
export function tierRanksForWave(wave: PickupWaveNumber): number[] {
  switch (wave) {
    case 1:
      return [1, 2];
    case 2:
      return [3];
    case 3:
      return [4];
    case 4:
      return [5, 6];
    default:
      return [];
  }
}

/** open_tier_rank after a wave completes (legacy checkpoints / admin UI). */
export function openTierRankAfterWave(wave: PickupWaveNumber): number {
  switch (wave) {
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 6;
    default:
      return 2;
  }
}

export function parseWaveState(raw: unknown): PickupWaveState {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const pickStr = (k: string) => {
    const v = o[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const pickNum = (k: string) => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    wave1_sent_at: pickStr("wave1_sent_at"),
    wave2_sent_at: pickStr("wave2_sent_at"),
    wave3_sent_at: pickStr("wave3_sent_at"),
    wave4_sent_at: pickStr("wave4_sent_at"),
    w1_to_w2_hours: pickNum("w1_to_w2_hours"),
    w2_to_w3_hours: pickNum("w2_to_w3_hours"),
    hours_until_at_promote: pickNum("hours_until_at_promote"),
  };
}

export function lastCompletedWave(state: PickupWaveState): PickupWaveNumber | 0 {
  if (state.wave4_sent_at) return 4;
  if (state.wave3_sent_at) return 3;
  if (state.wave2_sent_at) return 2;
  if (state.wave1_sent_at) return 1;
  return 0;
}

export function nextWaveToSend(state: PickupWaveState): PickupWaveNumber | null {
  if (!state.wave1_sent_at) return 1;
  if (!state.wave2_sent_at) return 2;
  if (!state.wave3_sent_at) return 3;
  if (!state.wave4_sent_at) return 4;
  return null;
}

/** Base hours between waves from hours-until-kickoff at promote (wave 1). */
export function baseWaveIntervalsHours(hoursUntilKickoff: number): {
  w1_to_w2: number;
  w2_to_w3: number;
} {
  const h = Math.max(0.25, hoursUntilKickoff);
  if (h <= 24) return { w1_to_w2: 2, w2_to_w3: 4 };
  if (h <= 48) return { w1_to_w2: 6, w2_to_w3: 12 };
  return { w1_to_w2: 12, w2_to_w3: 24 };
}

/** ~40% of run capacity — target acceptances per wave tranche. */
export function waveAcceptanceTarget(capacity: number): number {
  if (capacity <= 0) return 0;
  return capacity * 0.4;
}

/** Fraction of base inter-wave delay that must elapse before acceptance can adjust timing. */
export const ACCEPTANCE_CHECK_MIN_FRACTION = 0.5;

/**
 * Adjust total delay before the next wave using RSVP acceptance after the prior wave.
 * Only call once ≥50% of base delay has elapsed (see {@link reconcileInterWaveSchedule}).
 * >70% of capacity filled → 1.5× base; <30% of wave target → 0h total (open next wave).
 */
export function adjustHoursAfterWave(
  baseHours: number,
  acceptedCount: number,
  capacity: number,
): number {
  if (capacity <= 0) return baseHours;
  const fillRate = acceptedCount / capacity;
  const target = waveAcceptanceTarget(capacity);
  if (fillRate > 0.7) return baseHours * 1.5;
  if (acceptedCount < 0.3 * target) return 0;
  return baseHours;
}

/** Hours that must pass after a wave before acceptance rate may change the next-wave schedule. */
export function acceptanceCheckMinHours(baseHours: number): number {
  return baseHours * ACCEPTANCE_CHECK_MIN_FRACTION;
}

export type InterWaveReconcileResult =
  | { fireNow: true }
  | { fireNow: false; next_wave_at: string };

/**
 * Decide whether to open the next wave now or reschedule, after the minimum acceptance wait.
 */
export function reconcileInterWaveSchedule(opts: {
  priorWaveSentIso: string;
  baseHours: number;
  nowMs: number;
  acceptedCount: number;
  capacity: number;
}): InterWaveReconcileResult {
  const sentMs = Date.parse(opts.priorWaveSentIso);
  if (!Number.isFinite(sentMs)) {
    return { fireNow: true };
  }

  const baseHours = Math.max(0, opts.baseHours);
  const elapsedHours = Math.max(0, (opts.nowMs - sentMs) / MS_PER_HOUR);
  const minWaitHours = acceptanceCheckMinHours(baseHours);

  if (elapsedHours < minWaitHours) {
    return {
      fireNow: false,
      next_wave_at: isoAfterMs(sentMs, minWaitHours),
    };
  }

  const adjustedTotalHours = adjustHoursAfterWave(baseHours, opts.acceptedCount, opts.capacity);
  if (adjustedTotalHours <= elapsedHours) {
    return { fireNow: true };
  }

  return {
    fireNow: false,
    next_wave_at: isoAfterMs(sentMs, adjustedTotalHours),
  };
}

function baseHoursForGap(
  gap: "w1_to_w2" | "w2_to_w3",
  state: PickupWaveState,
): number {
  const hoursUntilBase = state.hours_until_at_promote ?? 168;
  const base = baseWaveIntervalsHours(hoursUntilBase);
  if (gap === "w1_to_w2") {
    return state.w1_to_w2_hours ?? base.w1_to_w2;
  }
  return state.w2_to_w3_hours ?? base.w2_to_w3;
}

/** First cron checkpoint: 50% of base delay after the wave that just fired (waves 1–2 only). */
export function initialInterWaveCheckpointIso(
  gap: "w1_to_w2" | "w2_to_w3",
  state: PickupWaveState,
  priorWaveSentIso: string,
  nowMs: number,
): string {
  const baseHours = baseHoursForGap(gap, state);
  const sentMs = Date.parse(priorWaveSentIso);
  if (!Number.isFinite(sentMs)) {
    return isoAfterMs(nowMs, acceptanceCheckMinHours(baseHours));
  }
  const checkpointMs = sentMs + acceptanceCheckMinHours(baseHours) * MS_PER_HOUR;
  return new Date(Math.max(nowMs, checkpointMs)).toISOString();
}

export async function countAcceptedPickupRsvps(
  admin: SupabaseClient,
  run_id: string,
): Promise<number> {
  const res = await admin
    .from("pickup_run_rsvps")
    .select("user_id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .in("status", ["confirmed", "pending_payment"]);
  if (res.error) return 0;
  return res.count ?? 0;
}

function isoAfterMs(fromMs: number, hours: number): string {
  return new Date(fromMs + hours * MS_PER_HOUR).toISOString();
}

/** When wave 3 should complete and wave 4 (last 2h) becomes due. */
export function wave4DueAtIso(anchorMs: number): string {
  return new Date(anchorMs - WAVE_4_HOURS_BEFORE_KICKOFF * MS_PER_HOUR).toISOString();
}

/**
 * Schedule `next_wave_at` after a wave fires.
 * Wave 4 is always anchored to kickoff minus 2 hours.
 */
export function scheduleNextWaveAt(
  completedWave: PickupWaveNumber,
  state: PickupWaveState,
  anchorMs: number | null,
  nowMs: number,
): string | null {
  const hoursUntilBase = state.hours_until_at_promote ?? 168;
  const base = baseWaveIntervalsHours(hoursUntilBase);

  if (completedWave === 1 && state.wave1_sent_at) {
    return initialInterWaveCheckpointIso("w1_to_w2", state, state.wave1_sent_at, nowMs);
  }

  if (completedWave === 2 && state.wave2_sent_at) {
    let at = Date.parse(initialInterWaveCheckpointIso("w2_to_w3", state, state.wave2_sent_at, nowMs));
    if (!Number.isFinite(at)) at = nowMs;
    if (anchorMs !== null) {
      const wave4Ms = anchorMs - WAVE_4_HOURS_BEFORE_KICKOFF * MS_PER_HOUR;
      at = Math.min(at, wave4Ms);
    }
    return new Date(Math.max(nowMs, at)).toISOString();
  }

  if (completedWave === 3) {
    if (anchorMs === null) return null;
    return wave4DueAtIso(anchorMs);
  }

  return null;
}

/** Invitees from earlier waves who have not confirmed or started payment. */
async function priorWaveNonAcceptedInviteesByWave(
  admin: SupabaseClient,
  run_id: string,
  openingWave: PickupWaveNumber,
): Promise<Map<number, string[]>> {
  if (openingWave <= 1) return new Map();

  const [invRes, rsvpRes] = await Promise.all([
    admin.from("pickup_run_invites").select("user_id,wave").eq("run_id", run_id).lt("wave", openingWave),
    admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", run_id)
      .in("status", ["confirmed", "pending_payment"]),
  ]);

  const accepted = new Set(
    (rsvpRes.data || [])
      .map((r: { user_id: string }) => r.user_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const byWave = new Map<number, string[]>();
  for (const row of invRes.data || []) {
    const uid = String((row as { user_id: string }).user_id || "");
    if (!uid || accepted.has(uid)) continue;
    const w = Number((row as { wave: number | null }).wave ?? 1);
    if (!Number.isFinite(w) || w < 1 || w >= openingWave) continue;
    const list = byWave.get(w) ?? [];
    list.push(uid);
    byWave.set(w, list);
  }

  return byWave;
}

async function sendPriorWaveReinviteReminders(
  admin: SupabaseClient,
  opts: { run_id: string; runTitle: string; openingWave: PickupWaveNumber },
): Promise<void> {
  const byWave = await priorWaveNonAcceptedInviteesByWave(admin, opts.run_id, opts.openingWave);
  const waves = Array.from(byWave.keys()).sort((a, b) => a - b);
  await Promise.all(
    waves.map((priorWave) =>
      sendPickupPriorWaveReinvitePush(admin, {
        userIds: byWave.get(priorWave) ?? [],
        runId: opts.run_id,
        runTitle: opts.runTitle,
        priorWave,
      }),
    ),
  );
}

async function addNewInvitesToRunBanterChat(
  admin: SupabaseClient,
  run_id: string,
  runTitle: string,
  anchorMs: number | null,
  newlyInvited: InvitePlayer[],
  wave: PickupWaveNumber,
): Promise<void> {
  if (!newlyInvited.length) return;

  const room = await findRunBanterRoom(admin, run_id);
  if (!room?.id) return;

  const memberRows = newlyInvited.map((p) => ({ room_id: room.id, user_id: p.user_id }));
  await admin.from("chat_room_members").upsert(memberRows, { onConflict: "room_id,user_id" });

  if (!room.created_by) return;

  const startLabel =
    anchorMs !== null
      ? new Date(anchorMs).toLocaleString("en-US", { timeZone: "America/New_York" })
      : "TBD";

  const body =
    wave === 4
      ? `Last call: more players invited to ${runTitle} (${startLabel}). Open the Pickup tab now — run starts in under 2 hours.`
      : wave === 1
        ? `You've been invited to ${runTitle} (${startLabel}). Open the Pickup tab for details and to submit your availability.`
        : `More players have been invited to ${runTitle} (${startLabel}). Open the Pickup tab for details and to submit your availability if you have not yet.`;

  await admin.from("chat_messages").insert({
    room_id: room.id,
    user_id: room.created_by,
    body,
  });
}

export type FireWaveResult =
  | { ok: false; error: string }
  | {
      ok: true;
      wave: PickupWaveNumber;
      newlyInvited: InvitePlayer[];
      wave_state: PickupWaveState;
      next_wave_at: string | null;
      open_tier_rank: number;
      current_wave: number;
    };

/** Insert invites for one wave, notify new invitees only, return updated scheduling fields. */
export async function firePickupWave(
  admin: SupabaseClient,
  opts: {
    run_id: string;
    runTitle: string;
    run_type: unknown;
    service_region: string | null | undefined;
    capacity: number;
    anchorMs: number | null;
    wave: PickupWaveNumber;
    wave_state: PickupWaveState;
    isoNow: string;
    nowMs: number;
  },
): Promise<FireWaveResult> {
  const tierRanks = tierRanksForWave(opts.wave);
  if (!tierRanks.length) {
    return { ok: false, error: `Invalid wave ${opts.wave}` };
  }

  if (opts.wave > 1) {
    await sendPriorWaveReinviteReminders(admin, {
      run_id: opts.run_id,
      runTitle: opts.runTitle,
      openingWave: opts.wave,
    });
  }

  const inv = await insertInvitesForTierRanks(
    admin,
    opts.run_id,
    tierRanks,
    opts.wave,
    opts.isoNow,
    opts.service_region,
    opts.run_type,
    opts.wave === 4 ? { selectEmergencyLastCall: true } : undefined,
  );

  if (!inv.ok) return { ok: false, error: inv.error };

  const newlyInvited = inv.newlyInvited;
  const userIds = newlyInvited.map((p) => p.user_id);

  await addNewInvitesToRunBanterChat(
    admin,
    opts.run_id,
    opts.runTitle,
    opts.anchorMs,
    newlyInvited,
    opts.wave,
  );

  await sendPickupInvitePush(admin, {
    userIds,
    runId: opts.run_id,
    runTitle: opts.runTitle,
    wave: opts.wave,
    emergency: opts.wave === 4,
  });

  const hoursUntilBase = opts.wave_state.hours_until_at_promote ?? 168;
  const base = baseWaveIntervalsHours(hoursUntilBase);

  const nextState: PickupWaveState = { ...opts.wave_state };
  const sentKey =
    opts.wave === 1
      ? "wave1_sent_at"
      : opts.wave === 2
        ? "wave2_sent_at"
        : opts.wave === 3
          ? "wave3_sent_at"
          : "wave4_sent_at";
  nextState[sentKey] = opts.isoNow;

  if (opts.wave === 1) {
    nextState.w1_to_w2_hours = base.w1_to_w2;
  } else if (opts.wave === 2) {
    nextState.w2_to_w3_hours = base.w2_to_w3;
  }

  const next_wave_at = scheduleNextWaveAt(opts.wave, nextState, opts.anchorMs, opts.nowMs);

  return {
    ok: true,
    wave: opts.wave,
    newlyInvited,
    wave_state: nextState,
    next_wave_at,
    open_tier_rank: openTierRankAfterWave(opts.wave),
    current_wave: opts.wave,
  };
}

export type StartWaveOutreachResult =
  | { ok: false; error: string; skipped?: boolean }
  | {
      ok: true;
      wave1_invited: number;
      next_wave_at: string | null;
      skipped?: boolean;
      reason?: string;
    };

/**
 * Wave 1 on hub promote: tier_rank 1–2 in-region approved players, push + wave_state.
 * Idempotent if outreach already started.
 */
export async function startSelectWaveOutreachOnHubPromote(
  admin: SupabaseClient,
  run: PickupRunWaveRow,
): Promise<StartWaveOutreachResult> {
  if (!isSelectPickupRunType(run.run_type)) {
    return { ok: true, wave1_invited: 0, next_wave_at: null, skipped: true, reason: "not_select" };
  }

  if (run.outreach_started_at) {
    return { ok: true, wave1_invited: 0, next_wave_at: run.next_wave_at ?? null, skipped: true, reason: "already_started" };
  }

  const run_id = String(run.id);
  const isoNow = new Date().toISOString();
  const nowMs = Date.now();

  const slotsRes = await admin.from("pickup_run_time_slots").select("start_at").eq("run_id", run_id);
  const slotRows = (slotsRes.data || []) as { start_at: string }[];
  const anchorMs = anchorStartAtMs(
    { start_at: (run.start_at as string | null) ?? null },
    slotRows,
  );
  const hoursUntil =
    anchorMs === null ? 168 : Math.max(0.25, (anchorMs - nowMs) / MS_PER_HOUR);

  const capacity = Number(run.capacity || 0);
  const wave_state: PickupWaveState = {
    hours_until_at_promote: hoursUntil,
  };

  const fired = await firePickupWave(admin, {
    run_id,
    runTitle: (run.title as string) || "Pickup Run",
    run_type: run.run_type,
    service_region: (run.service_region as string | null | undefined) ?? null,
    capacity,
    anchorMs,
    wave: 1,
    wave_state,
    isoNow,
    nowMs,
  });

  if (!fired.ok) return { ok: false, error: fired.error };

  let next_wave_at = fired.next_wave_at;
  if (anchorMs !== null && next_wave_at) {
    const wave4Ms = anchorMs - WAVE_4_HOURS_BEFORE_KICKOFF * MS_PER_HOUR;
    const nextMs = Date.parse(next_wave_at);
    if (Number.isFinite(nextMs) && nextMs > wave4Ms) {
      next_wave_at = new Date(Math.max(nowMs, wave4Ms)).toISOString();
    }
  }

  const up = await admin
    .from("pickup_runs")
    .update({
      outreach_started_at: isoNow,
      auto_managed: true,
      wave1_started_at: isoNow,
      open_tier_rank: fired.open_tier_rank,
      current_wave: fired.current_wave,
      next_wave_at,
      wave_state: fired.wave_state,
      updated_at: isoNow,
    })
    .eq("id", run_id);

  if (up.error) return { ok: false, error: up.error.message };

  return {
    ok: true,
    wave1_invited: fired.newlyInvited.length,
    next_wave_at,
  };
}

export type ProcessWaveCronResult = {
  run_id: string;
  action: string;
  detail?: string;
};

async function isRunAtCapacity(
  admin: SupabaseClient,
  run_id: string,
  capacity: number,
): Promise<boolean> {
  if (capacity <= 0) return false;
  const accepted = await countAcceptedPickupRsvps(admin, run_id);
  return accepted >= capacity;
}

/**
 * Open the next due wave for a select run (cron). Returns null if nothing to do.
 */
export async function processDueWaveForRun(
  admin: SupabaseClient,
  row: PickupRunWaveRow,
  nowMs: number,
  opts?: { force?: boolean },
): Promise<ProcessWaveCronResult | null> {
  const force = opts?.force === true;
  const run_id = String(row.id || "");
  if (!run_id) return null;

  if (!isSelectPickupRunType(row.run_type)) {
    const isoNow = new Date().toISOString();
    await admin.from("pickup_runs").update({ next_wave_at: null, updated_at: isoNow }).eq("id", run_id);
    return { run_id, action: "cleared_next_wave_non_select" };
  }

  const state = parseWaveState(row.wave_state);
  const nextWave = nextWaveToSend(state);
  if (nextWave === null || nextWave === 1) {
    return null;
  }

  const cap = Number(row.capacity || 0);
  if (await isRunAtCapacity(admin, run_id, cap)) {
    const isoNow = new Date().toISOString();
    await admin.from("pickup_runs").update({ next_wave_at: null, updated_at: isoNow }).eq("id", run_id);
    return { run_id, action: "stopped_full" };
  }

  const slotsRes = await admin.from("pickup_run_time_slots").select("start_at").eq("run_id", run_id);
  const slotRows = (slotsRes.data || []) as { start_at: string }[];
  const anchorMs = anchorStartAtMs(
    { start_at: (row.start_at as string | null) ?? null },
    slotRows,
  );

  if (!force && nextWave === 4) {
    if (anchorMs === null) {
      const isoNow = new Date().toISOString();
      await admin.from("pickup_runs").update({ next_wave_at: null, updated_at: isoNow }).eq("id", run_id);
      await flagSelectRunNeedsKickoffForWaves(admin, run_id, (row.title as string) || "Pickup Run");
      return { run_id, action: "stopped_wave4_no_anchor" };
    }
    const wave4Ms = anchorMs - WAVE_4_HOURS_BEFORE_KICKOFF * MS_PER_HOUR;
    if (nowMs < wave4Ms) {
      const isoNow = new Date().toISOString();
      await admin
        .from("pickup_runs")
        .update({ next_wave_at: wave4DueAtIso(anchorMs), updated_at: isoNow })
        .eq("id", run_id);
      return { run_id, action: "rescheduled_wave4_gate", detail: wave4DueAtIso(anchorMs) };
    }
  }

  if (!force && (nextWave === 2 || nextWave === 3)) {
    const priorSentIso = nextWave === 2 ? state.wave1_sent_at : state.wave2_sent_at;
    const gap = nextWave === 2 ? "w1_to_w2" : "w2_to_w3";
    if (priorSentIso) {
      const acceptedCount = await countAcceptedPickupRsvps(admin, run_id);
      const reconcile = reconcileInterWaveSchedule({
        priorWaveSentIso: priorSentIso,
        baseHours: baseHoursForGap(gap, state),
        nowMs,
        acceptedCount,
        capacity: cap,
      });
      if (!reconcile.fireNow) {
        const isoNow = new Date().toISOString();
        await admin
          .from("pickup_runs")
          .update({ next_wave_at: reconcile.next_wave_at, updated_at: isoNow })
          .eq("id", run_id);
        return {
          run_id,
          action: "rescheduled_acceptance_wait",
          detail: reconcile.next_wave_at,
        };
      }
    }
  }

  const isoNow = new Date().toISOString();
  const fired = await firePickupWave(admin, {
    run_id,
    runTitle: (row.title as string) || "Pickup Run",
    run_type: row.run_type,
    service_region: (row.service_region as string | null | undefined) ?? null,
    capacity: cap,
    anchorMs,
    wave: nextWave,
    wave_state: state,
    isoNow,
    nowMs,
  });

  if (!fired.ok) {
    return { run_id, action: "invite_failed", detail: fired.error };
  }

  let next_wave_at = fired.next_wave_at;
  if (nextWave === 3 && anchorMs !== null) {
    next_wave_at = wave4DueAtIso(anchorMs);
  }

  const up = await admin
    .from("pickup_runs")
    .update({
      open_tier_rank: fired.open_tier_rank,
      current_wave: fired.current_wave,
      next_wave_at,
      wave_state: fired.wave_state,
      updated_at: isoNow,
    })
    .eq("id", run_id);

  if (up.error) {
    return { run_id, action: "update_failed", detail: up.error.message };
  }

  return {
    run_id,
    action: `opened_wave_${nextWave}`,
    detail: `new_invites=${fired.newlyInvited.length} next=${next_wave_at ?? "none"}`,
  };
}

export async function flagSelectRunNeedsKickoffForWaves(
  admin: SupabaseClient,
  run_id: string,
  runTitle: string,
): Promise<void> {
  const message = `[Pickup waves] "${runTitle}" has no kickoff time; wave 4 cannot be scheduled. Set start_at or slots.`;
  await admin.from("pickup_run_updates").insert({ run_id, message, created_by: null });
  const room = await findRunBanterRoom(admin, run_id);
  if (room?.id && room.created_by) {
    await admin.from("chat_messages").insert({
      room_id: room.id,
      user_id: room.created_by,
      body: message,
    });
  }
}

/** Runs eligible for cron wave processing. */
export function pickupWaveCronRunColumns(): string {
  return "id,title,status,start_at,capacity,open_tier_rank,current_wave,next_wave_at,outreach_started_at,run_type,service_region,wave_state";
}
