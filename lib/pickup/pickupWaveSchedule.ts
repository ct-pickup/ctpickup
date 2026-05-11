/**
 * Time between tier waves depends on how far the run kickoff is.
 * Hours are measured from `now` (or caller) to anchor start (earliest slot or run.start_at).
 */
export function waveIntervalHoursForHoursUntilStart(hoursUntilStart: number): number {
  if (hoursUntilStart >= 168) return 24;
  if (hoursUntilStart >= 72) return 12;
  if (hoursUntilStart >= 24) return 6;
  return 2;
}

export function addWaveIntervalIso(fromMs: number, hoursUntilStartAtFrom: number): string {
  const h = waveIntervalHoursForHoursUntilStart(hoursUntilStartAtFrom);
  return new Date(fromMs + h * 3600000).toISOString();
}
