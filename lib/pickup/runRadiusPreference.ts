export const RUN_RADIUS_MILES_OPTIONS = [10, 20, 30, 50, 100] as const;
export type RunRadiusMiles = (typeof RUN_RADIUS_MILES_OPTIONS)[number];

export const DEFAULT_MAX_RUN_DISTANCE_MILES: RunRadiusMiles = 30;

export function clampMaxRunDistanceMiles(raw: unknown): RunRadiusMiles {
  const n = Math.round(Number(raw));
  if ((RUN_RADIUS_MILES_OPTIONS as readonly number[]).includes(n)) {
    return n as RunRadiusMiles;
  }
  return DEFAULT_MAX_RUN_DISTANCE_MILES;
}
