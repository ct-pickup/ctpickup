import { isPickupRunDateOnlyStartAt } from "@/lib/pickup/runStartAtDisplay";

/** ISO instant for start_at minus 24 hours (player-initiated refund if canceled strictly before this time). */
export function computeCancellationDeadline(startAtISO: string) {
  const startMs = new Date(startAtISO).getTime();
  if (!Number.isFinite(startMs)) {
    throw new RangeError("Invalid start_at for computeCancellationDeadline");
  }
  return new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
}

/** True if the current time is still before the 24-hour refund cutoff (uses start_at when valid, else cancellation_deadline). */
export function pickupPlayerRefundEligibleNow(
  run: { start_at?: string | null; cancellation_deadline?: string | null },
  nowMs: number = Date.now(),
): boolean {
  const startRaw = run.start_at != null ? String(run.start_at).trim() : "";
  if (startRaw && !isPickupRunDateOnlyStartAt(startRaw)) {
    try {
      const cutoffMs = new Date(computeCancellationDeadline(startRaw)).getTime();
      if (Number.isFinite(cutoffMs)) return nowMs < cutoffMs;
    } catch {
      // fall through to cancellation_deadline
    }
  }
  const d = run.cancellation_deadline != null ? String(run.cancellation_deadline).trim() : "";
  if (!d) return false;
  const t = new Date(d).getTime();
  return Number.isFinite(t) && nowMs < t;
}

/** Earliest kickoff time for checkpoint math: run.start_at if set, else earliest slot. */
export function anchorStartAtMs(
  run: { start_at: string | null },
  slots: { start_at: string }[],
): number | null {
  let best: number | null = null;
  const runStartRaw = run.start_at != null ? String(run.start_at).trim() : "";
  if (runStartRaw && !isPickupRunDateOnlyStartAt(runStartRaw)) {
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
