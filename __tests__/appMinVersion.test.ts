import { describe, expect, it } from "vitest";

import {
  FORCE_UPDATE_MIN_VERSION,
  forceUpdateEnabled,
  LEGACY_DEFAULT_MIN_VERSION,
  resolveMinAppVersion,
} from "../lib/api/appMinVersion";
import { compareSemver, isUpdateRequired } from "../mobile/lib/semver";

/** Verbatim copy of the v1.3.5 client check (612b9c7 mobile/app/_layout.tsx): blocked when compareSemver(cur, min) < 0. */
function v135Blocked(appVersion: string, minVersion: string): boolean {
  if (!minVersion || !appVersion) return false;
  return compareSemver(appVersion, minVersion) < 0;
}

const OLD_CLIENTS = ["1.3.3", "1.3.5"];
const NEW_CLIENTS = ["1.4.0", "1.4.1", "2.0.0"];

describe("forceUpdateEnabled", () => {
  it("is off unless explicitly turned on", () => {
    expect(forceUpdateEnabled({})).toBe(false);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: "" })).toBe(false);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: "false" })).toBe(false);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: "0" })).toBe(false);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: "true" })).toBe(true);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: " TRUE " })).toBe(true);
    expect(forceUpdateEnabled({ FORCE_UPDATE_ENABLED: "1" })).toBe(true);
  });
});

describe("flag off", () => {
  it("returns exactly the previous value", () => {
    expect(resolveMinAppVersion({})).toBe(LEGACY_DEFAULT_MIN_VERSION);
    expect(resolveMinAppVersion({ MIN_APP_VERSION: "1.2.0" })).toBe("1.2.0");
    expect(resolveMinAppVersion({ MIN_APP_VERSION: "junk" })).toBe(LEGACY_DEFAULT_MIN_VERSION);
    expect(resolveMinAppVersion({ FORCE_UPDATE_ENABLED: "false", MIN_APP_VERSION: "1.3.0" })).toBe("1.3.0");
  });

  it("forces neither old nor new clients", () => {
    const min = resolveMinAppVersion({});
    for (const v of [...OLD_CLIENTS, ...NEW_CLIENTS]) {
      expect(v135Blocked(v, min)).toBe(false);
      expect(isUpdateRequired(v, min)).toBe(false);
    }
  });
});

describe("flag on", () => {
  const min = resolveMinAppVersion({ FORCE_UPDATE_ENABLED: "true" });

  it("serves 1.4.0", () => {
    expect(min).toBe(FORCE_UPDATE_MIN_VERSION);
    expect(min).toBe("1.4.0");
  });

  it("forces clients below 1.4.0, including the v1.3.5 check", () => {
    for (const v of OLD_CLIENTS) {
      expect(v135Blocked(v, min)).toBe(true);
      expect(isUpdateRequired(v, min)).toBe(true);
    }
  });

  it("does not force 1.4.0 and later", () => {
    for (const v of NEW_CLIENTS) {
      expect(isUpdateRequired(v, min)).toBe(false);
    }
  });

  it("never lowers a higher MIN_APP_VERSION", () => {
    expect(resolveMinAppVersion({ FORCE_UPDATE_ENABLED: "true", MIN_APP_VERSION: "1.5.0" })).toBe("1.5.0");
  });
});

describe("isUpdateRequired", () => {
  it("never blocks on missing or malformed versions", () => {
    expect(isUpdateRequired("", "1.4.0")).toBe(false);
    expect(isUpdateRequired("1.3.5", "")).toBe(false);
    expect(isUpdateRequired("1.3", "1.4.0")).toBe(false);
  });
});
