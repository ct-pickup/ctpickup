import { runTimeTbd } from "@/lib/pickup/runStartAtDisplay";

/** ISO instant for start_at minus 24 hours (player-initiated refund if canceled strictly before this time). */
export function computeCancellationDeadline(startAtISO: string) {
  const startMs = new Date(startAtISO).getTime();
  if (!Number.isFinite(startMs)) {
    throw new RangeError("Invalid start_at for computeCancellationDeadline");
  }
  return new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
}

/** The 24-hour refund cutoff in ms (start_at minus 24h unless the time is TBD, else cancellation_deadline), or null. */
export function pickupRefundCutoffMs(run: {
  start_at?: string | null;
  time_tbd?: boolean | null;
  cancellation_deadline?: string | null;
}): number | null {
  const startRaw = run.start_at != null ? String(run.start_at).trim() : "";
  if (startRaw && !runTimeTbd(run)) {
    try {
      const cutoffMs = new Date(computeCancellationDeadline(startRaw)).getTime();
      if (Number.isFinite(cutoffMs)) return cutoffMs;
    } catch {
      // fall through to cancellation_deadline
    }
  }
  const d = run.cancellation_deadline != null ? String(run.cancellation_deadline).trim() : "";
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/** True if the current time is still before the 24-hour refund cutoff (uses start_at when valid, else cancellation_deadline). */
export function pickupPlayerRefundEligibleNow(
  run: { start_at?: string | null; time_tbd?: boolean | null; cancellation_deadline?: string | null },
  nowMs: number = Date.now(),
): boolean {
  const cutoffMs = pickupRefundCutoffMs(run);
  return cutoffMs != null && nowMs < cutoffMs;
}

/** Kickoff in ms, or null when start_at is missing, invalid, or the noon placeholder of a TBD run. */
export function realKickoffMs(run: { start_at?: string | null; time_tbd?: boolean | null }): number | null {
  if (runTimeTbd(run)) return null;
  const raw = run.start_at != null ? String(run.start_at).trim() : "";
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Earliest kickoff time for checkpoint math: run.start_at unless its time is TBD, and the earliest slot. */
export function anchorStartAtMs(
  run: { start_at: string | null; time_tbd?: boolean | null },
  slots: { start_at: string }[],
): number | null {
  let best: number | null = null;
  const runStartRaw = run.start_at != null ? String(run.start_at).trim() : "";
  if (runStartRaw && !runTimeTbd(run)) {
    const t = new Date(runStartRaw).getTime();
    if (Number.isFinite(t)) best = t;
  }
  for (const s of slots) {
    const t = new Date(s.start_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}
