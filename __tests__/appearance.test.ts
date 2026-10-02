import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  nativeColorSchemeFor,
  parseAppearancePreference,
  readAppearancePreference,
  resolveColorScheme,
} from "../mobile/lib/appearance";

describe("resolveColorScheme", () => {
  it("defaults to light whatever the phone says", () => {
    expect(DEFAULT_APPEARANCE).toBe("light");
    expect(resolveColorScheme("light", "dark")).toBe("light");
    expect(resolveColorScheme("light", null)).toBe("light");
  });

  it("stays dark when the user picks Dark", () => {
    expect(resolveColorScheme("dark", "light")).toBe("dark");
    expect(resolveColorScheme("dark", undefined)).toBe("dark");
  });

  it("follows the phone for Match system, light when unknown", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
    expect(resolveColorScheme("system", "light")).toBe("light");
    expect(resolveColorScheme("system", null)).toBe("light");
    expect(resolveColorScheme("system", "unspecified")).toBe("light");
  });
});

describe("nativeColorSchemeFor", () => {
  it("clears the native override only for Match system", () => {
    expect(nativeColorSchemeFor("light")).toBe("light");
    expect(nativeColorSchemeFor("dark")).toBe("dark");
    expect(nativeColorSchemeFor("system")).toBe("unspecified");
  });
});

describe("parseAppearancePreference", () => {
  it("accepts the three stored values and nothing else", () => {
    expect(parseAppearancePreference("light")).toBe("light");
    expect(parseAppearancePreference("dark")).toBe("dark");
    expect(parseAppearancePreference("system")).toBe("system");
    expect(parseAppearancePreference("automatic")).toBe("light");
    expect(parseAppearancePreference(null)).toBe("light");
    expect(parseAppearancePreference(undefined)).toBe("light");
  });
});

describe("readAppearancePreference", () => {
  it("reads the stored value under the appearance key", async () => {
    const keys: string[] = [];
    const storage = {
      async getItem(key: string) {
        keys.push(key);
        return "system";
      },
    };
    await expect(readAppearancePreference(storage)).resolves.toBe("system");
    expect(keys).toEqual([APPEARANCE_STORAGE_KEY]);
  });

  it("falls back to light when nothing is stored", async () => {
    await expect(readAppearancePreference({ getItem: async () => null })).resolves.toBe("light");
  });

  it("falls back to light when the stored value is corrupt", async () => {
    await expect(readAppearancePreference({ getItem: async () => "{oops" })).resolves.toBe("light");
  });

  it("falls back to light when storage throws", async () => {
    const storage = {
      async getItem(): Promise<string | null> {
        throw new Error("Native module is null");
      },
    };
    await expect(readAppearancePreference(storage)).resolves.toBe("light");
  });
});
