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
