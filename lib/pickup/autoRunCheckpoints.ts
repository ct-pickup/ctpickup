import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHECKPOINT_12H_BEFORE_MS,
  CHECKPOINT_1H_BEFORE_MS,
  CHECKPOINT_24H_BEFORE_MS,
  CHECKPOINT_6H_BEFORE_MS,
  EXPAND_WAVE_MIN_COMMITTED,
  LIKELY_ON_TIER1_PER_SLOT,
  finalizeMinCommitted,
} from "@/lib/pickup/autoRunConfig";
import { insertInvitesForTierRanks, sendPickupInviteSms } from "@/lib/pickup/pickupInvites";
import { anchorStartAtMs, computeCancellationDeadline } from "@/lib/pickup/runScheduling";

function isTier1(rank: number) {
  return rank === 1 || rank === 2;
}

export function countDistinctCommittedPlayers(
  availability: { user_id: string; state: string; slot_id: string | null }[]
): number {
  return new Set(
    availability.filter((a) => a.state === "available" && a.slot_id).map((a) => a.user_id)
  ).size;
}

export function countConfirmedRsvps(rsvps: { status: string }[]): number {
  return rsvps.filter((r) => r.status === "confirmed").length;
}

function waveLabel(open: number | null | undefined): string {
  if (open === null || open === undefined) return "Not launched";
  if (open <= 2) return "Wave 1 (Tier 1A–1B)";
  if (open === 3) return "Through Tier 2";
  if (open === 4) return "Through Tier 3";
  if (open === 5) return "Through Tier 4";
  return "Public tier window";
}

export function describePickupAutoStatus(
  run: Record<string, unknown> | null,
  slots: { start_at: string }[],
  availability: { user_id: string; state: string; slot_id: string | null }[],
  rsvps: { status: string }[],
  recentMessages: string[] = []
) {
  if (!run) return null;

  const anchorMs = anchorStartAtMs(
    { start_at: (run.start_at as string | null) ?? null },
    slots
  );
  const committed = countDistinctCommittedPlayers(availability);
  const confirmed = countConfirmedRsvps(rsvps);
  const open = run.open_tier_rank as number | null | undefined;
  const autoManaged = !!run.auto_managed;
  const outreachAt = run.outreach_started_at as string | null | undefined;

  let nextStep = "—";
  const st = run.status as string;
  if (st === "active") {
    nextStep = "Run is active (finalized).";
  } else if (st === "canceled") {
    nextStep = "Run canceled.";
  } else if (!autoManaged) {
    nextStep = "Use Launch outreach to start the timed pipeline (36h+ before kickoff).";
  } else if (anchorMs === null) {
    nextStep = "Add at least one time slot so kickoff time is known for checkpoints.";
  } else if (!outreachAt) {
    nextStep = "Outreach not marked started (data inconsistency).";
  } else {
    const t = Date.now();
    const msToStart = anchorMs - t;
    if (msToStart > CHECKPOINT_24H_BEFORE_MS) {
      nextStep = "Before 24h checkpoint: wait or rely on player commitments.";
    } else if (!(run.auto_cp_24h_at as string | undefined)) {
      nextStep = "Due: 24h checkpoint (expand tiers if below commitment threshold).";
    } else if (msToStart > CHECKPOINT_12H_BEFORE_MS) {
      nextStep = "Between 24h and 12h checkpoints.";
    } else if (!(run.auto_cp_12h_at as string | undefined)) {
      nextStep = "Due: 12h checkpoint (expand further if needed).";
    } else if (msToStart > CHECKPOINT_6H_BEFORE_MS) {
      nextStep = "Between 12h and 6h checkpoints.";
    } else if (!(run.auto_cp_6h_at as string | undefined)) {
      nextStep = "Due: 6h checkpoint (likely_on if Tier-1 threshold met on a slot).";
    } else if (msToStart > CHECKPOINT_1H_BEFORE_MS) {
      nextStep = "Between 6h and 1h — finalize window approaching.";
    } else if (!(run.auto_cp_1h_at as string | undefined)) {
      nextStep = "Due: 1h checkpoint — auto-finalize or cancel.";
    } else {
      nextStep = "Checkpoint pipeline complete for this run.";
    }
  }

  return {
    anchor_start_at: anchorMs ? new Date(anchorMs).toISOString() : null,
    hours_until_start:
      anchorMs !== null ? Math.round(((anchorMs - Date.now()) / 3600000) * 10) / 10 : null,
    committed_players: committed,
    confirmed_players: confirmed,
    expand_threshold: EXPAND_WAVE_MIN_COMMITTED,
    likely_on_tier1_per_slot: LIKELY_ON_TIER1_PER_SLOT,
    finalize_min_committed: finalizeMinCommitted(run.capacity as number | null),
    open_tier_rank: open ?? null,
    current_wave_label: waveLabel(open ?? null),
    outreach_started_at: outreachAt ?? null,
    auto_managed: autoManaged,
    checkpoints: {
      cp_24h_at: run.auto_cp_24h_at ?? null,
      cp_12h_at: run.auto_cp_12h_at ?? null,
      cp_6h_at: run.auto_cp_6h_at ?? null,
      cp_1h_at: run.auto_cp_1h_at ?? null,
    },
    next_step: nextStep,
    recent_log: recentMessages,
  };
}

async function pickBestSlotByCommitments(
  admin: SupabaseClient,
  run_id: string,
  availability: { user_id: string; slot_id: string | null; state: string }[]
): Promise<{ slot_id: string; count: number } | null> {
  const avail = availability.filter((a) => a.state === "available" && a.slot_id);
  const bySlot: Record<string, Set<string>> = {};
  for (const a of avail) {
    const sid = a.slot_id as string;
    if (!bySlot[sid]) bySlot[sid] = new Set();
    bySlot[sid].add(a.user_id);
  }
  let best: { slot_id: string; count: number } | null = null;
  for (const [slot_id, set] of Object.entries(bySlot)) {
    const c = set.size;
    if (!best || c > best.count) best = { slot_id, count: c };
  }
  return best;
}

async function applyLikelyOnFromAvailability(
  admin: SupabaseClient,
  run_id: string,
  run: { likely_on_slot_id: string | null }
): Promise<boolean> {
  if (run.likely_on_slot_id) return false;

  const availRes = await admin
    .from("pickup_run_availability")
    .select("user_id, slot_id, state")
    .eq("run_id", run_id);

  const av = (availRes.data || []).filter((a) => a.state === "available" && a.slot_id);
  const ids = Array.from(new Set(av.map((a) => a.user_id)));
  const profs = ids.length
    ? await admin.from("profiles").select("id, tier_rank").in("id", ids)
    : { data: [] as { id: string; tier_rank: number | null }[] };

  const rankMap: Record<string, number> = {};
  for (const p of profs.data || []) rankMap[p.id] = p.tier_rank ?? 6;

  const counts: Record<string, number> = {};
  for (const a of av) {
    const r = rankMap[a.user_id] ?? 6;
    if (!isTier1(r)) continue;
    counts[a.slot_id as string] = (counts[a.slot_id as string] || 0) + 1;
  }

  let winner: string | null = null;
  let best = 0;
  for (const [slot, c] of Object.entries(counts)) {
    if (c >= LIKELY_ON_TIER1_PER_SLOT && c > best) {
      winner = slot;
      best = c;
    }
  }

  if (!winner) return false;

  const now = new Date().toISOString();
  const up = await admin
    .from("pickup_runs")
    .update({
      status: "likely_on",
      likely_on_at: now,
      likely_on_slot_id: winner,
      updated_at: now,
    })
    .eq("id", run_id);

  return !up.error;
}

export async function processAutoPickupRun(
  admin: SupabaseClient,
  runId: string
): Promise<{ messages: string[] }> {
  const messages: string[] = [];

  const runRes = await admin.from("pickup_runs").select("*").eq("id", runId).maybeSingle();
  const run = runRes.data as Record<string, unknown> | null;
  if (!run || !(run.auto_managed as boolean)) return { messages };

  if ((run.status as string) === "canceled" || (run.status as string) === "active") {
    return { messages };
  }
  if (run.final_slot_id) return { messages };

  const slotsRes = await admin.from("pickup_run_time_slots").select("id,start_at").eq("run_id", runId);
  const slots = (slotsRes.data || []) as { id: string; start_at: string }[];

  const availRes = await admin
    .from("pickup_run_availability")
    .select("user_id,slot_id,state")
    .eq("run_id", runId);
  let availability = (availRes.data || []) as {
    user_id: string;
    slot_id: string | null;
    state: string;
  }[];

  const anchorMs = anchorStartAtMs(
    { start_at: (run.start_at as string | null) ?? null },
    slots
  );
  if (anchorMs === null) return { messages };

  const nowMs = Date.now();
  let committed = countDistinctCommittedPlayers(availability);
  const runType = (run.run_type as string) || "select";
  const isoNow = new Date().toISOString();

  const fire24 = nowMs >= anchorMs - CHECKPOINT_24H_BEFORE_MS && !run.auto_cp_24h_at;
  const fire12 = nowMs >= anchorMs - CHECKPOINT_12H_BEFORE_MS && !run.auto_cp_12h_at;
  const fire6 = nowMs >= anchorMs - CHECKPOINT_6H_BEFORE_MS && !run.auto_cp_6h_at;
  const fire1 = nowMs >= anchorMs - CHECKPOINT_1H_BEFORE_MS && !run.auto_cp_1h_at;

  async function reloadAvailability() {
    const ar = await admin
      .from("pickup_run_availability")
      .select("user_id,slot_id,state")
      .eq("run_id", runId);
    return (ar.data || []) as { user_id: string; slot_id: string | null; state: string }[];
  }

  if (fire24) {
    let patch: Record<string, unknown> = { auto_cp_24h_at: isoNow, updated_at: isoNow };
    if (runType === "select" && committed < EXPAND_WAVE_MIN_COMMITTED) {
      const open = Number(run.open_tier_rank ?? 2);
      if (open < 6) {
        const nextOpen = Math.min(6, open + 1);
        const newTier = nextOpen;
        const inv = await insertInvitesForTierRanks(admin, runId, [newTier], 2, isoNow);
        if (!inv.ok) {
          messages.push(`24h checkpoint: invite insert failed: ${inv.error}`);
        } else {
          patch.open_tier_rank = nextOpen;
          run.open_tier_rank = nextOpen;
          const txt = `CT Pickup: you’re invited to submit availability for an upcoming run. Details: ${process.env.NEXT_PUBLIC_SITE_URL || ""}/pickup`;
          await sendPickupInviteSms(inv.newlyInvited, txt);
          messages.push(
            `24h checkpoint: expanded open_tier_rank to ${nextOpen}; ${inv.newlyInvited.length} new invites (SMS to numbers on file).`
          );
        }
      }
    } else {
      messages.push(
        runType === "select"
          ? `24h checkpoint: committed ${committed} ≥ ${EXPAND_WAVE_MIN_COMMITTED}, no expand.`
          : "24h checkpoint: public run — no tier expand."
      );
    }
    await admin.from("pickup_runs").update(patch).eq("id", runId);
    run.auto_cp_24h_at = isoNow;
    availability = await reloadAvailability();
    committed = countDistinctCommittedPlayers(availability);
  }

  if (fire12) {
    committed = countDistinctCommittedPlayers(await reloadAvailability());
    if (runType === "select" && committed < EXPAND_WAVE_MIN_COMMITTED) {
      const open = Number(run.open_tier_rank ?? 2);
      if (open < 6) {
        const nextOpen = Math.min(6, open + 1);
        const newTier = nextOpen;
        const inv = await insertInvitesForTierRanks(admin, runId, [newTier], 3, isoNow);
        if (!inv.ok) {
          messages.push(`12h checkpoint: invite insert failed: ${inv.error}`);
        } else {
          const up = await admin
            .from("pickup_runs")
            .update({ open_tier_rank: nextOpen, updated_at: isoNow })
            .eq("id", runId);
          if (!up.error) {
            run.open_tier_rank = nextOpen;
            const txt = `CT Pickup: you’re invited to submit availability for an upcoming run. Details: ${process.env.NEXT_PUBLIC_SITE_URL || ""}/pickup`;
            await sendPickupInviteSms(inv.newlyInvited, txt);
            messages.push(
              `12h checkpoint: expanded open_tier_rank to ${nextOpen}; ${inv.newlyInvited.length} new invites.`
            );
          }
        }
      }
    } else {
      messages.push(
        runType === "select"
          ? `12h checkpoint: committed ${committed} — no expand.`
          : "12h checkpoint: public run — no tier expand."
      );
    }
    await admin
      .from("pickup_runs")
      .update({ auto_cp_12h_at: isoNow, updated_at: isoNow })
      .eq("id", runId);
    run.auto_cp_12h_at = isoNow;
  }

  if (fire6) {
    const rr = await admin.from("pickup_runs").select("likely_on_slot_id").eq("id", runId).maybeSingle();
    const ok = await applyLikelyOnFromAvailability(admin, runId, {
      likely_on_slot_id: (rr.data?.likely_on_slot_id as string | null) ?? null,
    });
    messages.push(
      ok
        ? "6h checkpoint: marked likely_on (Tier-1 threshold on a slot)."
        : "6h checkpoint: likely_on threshold not met yet."
    );
    await admin.from("pickup_runs").update({ auto_cp_6h_at: isoNow, updated_at: isoNow }).eq("id", runId);
    run.auto_cp_6h_at = isoNow;
  }

  if (fire1) {
    availability = await reloadAvailability();
    const minFin = finalizeMinCommitted(run.capacity as number | null);
    const best = await pickBestSlotByCommitments(admin, runId, availability);
    if (best && best.count >= minFin) {
      const slotRow = await admin
        .from("pickup_run_time_slots")
        .select("id,start_at")
        .eq("id", best.slot_id)
        .maybeSingle();
      const st = slotRow.data?.start_at;
      if (st) {
        const cancellation_deadline = computeCancellationDeadline(st);
        const up = await admin
          .from("pickup_runs")
          .update({
            final_slot_id: best.slot_id,
            start_at: st,
            status: "active",
            cancellation_deadline,
            updated_at: isoNow,
          })
          .eq("id", runId);
        messages.push(
          up.error
            ? `1h checkpoint: finalize failed: ${up.error.message}`
            : `1h checkpoint: auto-finalized slot with ${best.count} commitments (min ${minFin}).`
        );
      } else {
        messages.push("1h checkpoint: could not load slot row to finalize.");
      }
    } else {
      const up = await admin
        .from("pickup_runs")
        .update({
          status: "canceled",
          is_current: false,
          canceled_at: isoNow,
          canceled_reason: "auto_below_threshold_1h",
          updated_at: isoNow,
        })
        .eq("id", runId);
      messages.push(
        up.error
          ? `1h checkpoint: cancel failed: ${up.error.message}`
          : `1h checkpoint: canceled run (commitments ${best?.count ?? 0} < ${minFin}).`
      );
    }
    await admin.from("pickup_runs").update({ auto_cp_1h_at: isoNow, updated_at: isoNow }).eq("id", runId);
    run.auto_cp_1h_at = isoNow;
  }

  return { messages };
}

export async function processAllAutoPickupRuns(admin: SupabaseClient): Promise<{ processed: number }> {
  const res = await admin
    .from("pickup_runs")
    .select("id")
    .eq("auto_managed", true)
    .in("status", ["planning", "likely_on"]);

  const rows = res.data || [];
  for (const r of rows) {
    await processAutoPickupRun(admin, r.id as string);
  }
  return { processed: rows.length };
}
