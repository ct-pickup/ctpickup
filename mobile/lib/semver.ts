export function parseSemver(raw: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}

/** Unparseable versions compare equal, so a bad value never blocks the app. */
export function compareSemver(aRaw: string, bRaw: string): -1 | 0 | 1 {
  const a = parseSemver(aRaw);
  const b = parseSemver(bRaw);
  if (!a || !b) return 0;
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/** Same rule every shipped build uses on /api/app-version: blocked only when the app is below min_version. */
export function isUpdateRequired(appVersion: string, minVersion: string): boolean {
  if (!appVersion.trim() || !minVersion.trim()) return false;
  return compareSemver(appVersion, minVersion) < 0;
}
