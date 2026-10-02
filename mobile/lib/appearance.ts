/**
 * Appearance preference: Light (default), Dark, or Match system.
 * Pure logic only so it can be unit tested without React Native.
 */

export type AppearancePreference = "light" | "dark" | "system";
export type ResolvedColorScheme = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "ctpickup.appearance.v1";
export const DEFAULT_APPEARANCE: AppearancePreference = "light";

export const APPEARANCE_OPTIONS: ReadonlyArray<{ value: AppearancePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

export function parseAppearancePreference(raw: unknown): AppearancePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_APPEARANCE;
}

/** Light unless the user picked Dark, or picked Match system while the phone is dark. */
export function resolveColorScheme(
  preference: AppearancePreference,
  systemScheme: string | null | undefined,
): ResolvedColorScheme {
  if (preference === "system") return systemScheme === "dark" ? "dark" : "light";
  return preference;
}

/** Value for Appearance.setColorScheme. "unspecified" clears the override so the OS scheme shows through. */
export function nativeColorSchemeFor(preference: AppearancePreference): "light" | "dark" | "unspecified" {
  return preference === "system" ? "unspecified" : preference;
}

type PreferenceStorage = { getItem(key: string): Promise<string | null> };

/** Never throws: a missing, corrupt or unreadable value falls back to Light. */
export async function readAppearancePreference(storage: PreferenceStorage): Promise<AppearancePreference> {
  try {
    return parseAppearancePreference(await storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}
