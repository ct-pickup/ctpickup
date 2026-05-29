/** Structured pickup logs — always on for poll/load failures; verbose in dev. */
const PREFIX = "[pickup]";

export function logPickupDiagnostic(
  event: string,
  data: Record<string, unknown>,
  opts?: { always?: boolean },
): void {
  if (!opts?.always && !__DEV__) return;
  try {
    console.log(`${PREFIX} ${event}`, data);
  } catch {
    /* ignore */
  }
}

/** Production-visible when a listed planning run should show a poll but does not. */
export function logPickupPollMismatch(
  reason: string,
  data: Record<string, unknown>,
): void {
  try {
    console.error(`${PREFIX} poll_visible_run_no_poll`, { reason, ...data });
  } catch {
    /* ignore */
  }
}
