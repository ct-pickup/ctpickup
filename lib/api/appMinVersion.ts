/**
 * Minimum app version served by /api/app-version.
 *
 * Every shipped app (v1.3.5 included) reads `min_version` and shows a blocking "Update Required" screen when
 * its own version is lower. Until FORCE_UPDATE_ENABLED is on, the endpoint keeps returning exactly what it
 * returned before (MIN_APP_VERSION, else 1.1.0), so nobody is forced.
 */

export const LEGACY_DEFAULT_MIN_VERSION = "1.1.0";
export const FORCE_UPDATE_MIN_VERSION = "1.4.0";

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

type VersionEnv = {
  MIN_APP_VERSION?: string;
  FORCE_UPDATE_ENABLED?: string;
};

export function forceUpdateEnabled(env: VersionEnv): boolean {
  const raw = env.FORCE_UPDATE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** The pre-flag value: MIN_APP_VERSION when it is a valid x.y.z, else 1.1.0. */
export function legacyMinVersion(env: VersionEnv): string {
  const raw = env.MIN_APP_VERSION?.trim();
  return raw && SEMVER_RE.test(raw) ? raw : LEGACY_DEFAULT_MIN_VERSION;
}

export function resolveMinAppVersion(env: VersionEnv): string {
  const legacy = legacyMinVersion(env);
  if (!forceUpdateEnabled(env)) return legacy;
  return compare(legacy, FORCE_UPDATE_MIN_VERSION) > 0 ? legacy : FORCE_UPDATE_MIN_VERSION;
}
