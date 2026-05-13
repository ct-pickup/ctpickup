/**
 * Client-side mirror of `lib/pickup/runScheduling.pickupPlayerRefundEligibleNow`
 * so cancel confirmations match server refund behavior.
 */
export type PickupRunRefundTiming = {
  start_at?: string | null;
  cancellation_deadline?: string | null;
};

function computeCancellationDeadline(startAtISO: string): string {
  const startMs = new Date(startAtISO).getTime();
  if (!Number.isFinite(startMs)) {
    throw new RangeError("Invalid start_at for computeCancellationDeadline");
  }
  return new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
}

export function pickupPlayerRefundEligibleClient(
  run: PickupRunRefundTiming,
  nowMs: number = Date.now(),
): boolean {
  const startRaw = run.start_at != null ? String(run.start_at).trim() : "";
  if (startRaw) {
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
