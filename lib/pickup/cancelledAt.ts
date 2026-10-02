import { isPickupRunDateOnlyStartAt } from "@/lib/pickup/runStartAtDisplay";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
/** Tolerates a client clock running slightly ahead when the admin leaves the field at "now". */
const FUTURE_SKEW_MS = 60_000;

export type CancelledAtCheck = { ok: true; ms: number } | { ok: false; error: string };

/**
 * When a player asked for their spot to be cancelled. Missing means now. Otherwise it must be a full ISO date-time
 * with a timezone, not in the future, and not after kickoff (checked only when start_at is a real kickoff time).
 */
export function parseCancelledAt(raw: unknown, run: { start_at: string | null }, nowMs: number): CancelledAtCheck {
  if (raw == null || raw === "") return { ok: true, ms: nowMs };
  const s = typeof raw === "string" ? raw.trim() : "";
  const ms = ISO_DATE_TIME.test(s) ? new Date(s).getTime() : NaN;
  if (!Number.isFinite(ms)) {
    return { ok: false, error: "cancelled_at must be an ISO date-time with a timezone, e.g. 2026-10-02T18:30:00Z." };
  }
  if (ms > nowMs + FUTURE_SKEW_MS) return { ok: false, error: "cancelled_at cannot be in the future." };
  const start = run.start_at ? String(run.start_at) : "";
  if (start && !isPickupRunDateOnlyStartAt(start)) {
    const kickoff = new Date(start).getTime();
    if (Number.isFinite(kickoff) && ms > kickoff) return { ok: false, error: "cancelled_at cannot be after kickoff." };
  }
  return { ok: true, ms };
}
