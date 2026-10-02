import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, useColorScheme as useSystemColorScheme } from "react-native";

import { appAsyncStorage } from "@/lib/appAsyncStorage";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  nativeColorSchemeFor,
  readAppearancePreference,
  resolveColorScheme,
  type AppearancePreference,
  type ResolvedColorScheme,
} from "@/lib/appearance";

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolved: ResolvedColorScheme;
  /** False until the stored preference has been read; the splash stays up until then. */
  isReady: boolean;
  setPreference: (next: AppearancePreference) => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

// Start reading at import time so the value is usually ready before fonts finish loading.
const storedPreference = readAppearancePreference(appAsyncStorage);

function applyNativeColorScheme(preference: AppearancePreference) {
  if (typeof Appearance.setColorScheme !== "function") return;
  try {
    // RN 0.81 types predate "unspecified"; the native module accepts it on every version.
    Appearance.setColorScheme(nativeColorSchemeFor(preference) as Parameters<typeof Appearance.setColorScheme>[0]);
  } catch {
    // Web and some test hosts have no native Appearance module.
  }
}

applyNativeColorScheme(DEFAULT_APPEARANCE);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>(DEFAULT_APPEARANCE);
  const [isReady, setIsReady] = useState(false);
  const systemScheme = useSystemColorScheme();

  useEffect(() => {
    let cancelled = false;
    void storedPreference.then((stored) => {
      if (cancelled) return;
      applyNativeColorScheme(stored);
      setPreferenceState(stored);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback(async (next: AppearancePreference) => {
    applyNativeColorScheme(next);
    setPreferenceState(next);
    await appAsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next);
  }, []);

  const resolved = resolveColorScheme(preference, systemScheme);

  const value = useMemo(
    () => ({ preference, resolved, isReady, setPreference }),
    [preference, resolved, isReady, setPreference],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}

/** Scheme the app should render in. Light outside the provider. */
export function useResolvedColorScheme(): ResolvedColorScheme {
  return useContext(AppearanceContext)?.resolved ?? "light";
}
