import { useMemo } from "react";
import { useColorScheme } from "react-native";

import {
  darkTheme,
  lightTheme,
  radius,
  themeForScheme,
  type Theme,
  type ThemeColors,
} from "@theme/tokens";

/**
 * Headline face for every serif-style title. Swap this one line to change it,
 * e.g. { fontFamily: "InstrumentSerif_400Regular" } restores Instrument Serif.
 * The family file already carries the weight, so styles must not add fontWeight.
 */
export const headline = { fontFamily: "Archivo_700Bold", letterSpacing: -0.5 } as const;

let current: Theme = lightTheme;

/** Latest theme published during render. Helpers can read this without a hook. */
export function themeNow(): Theme {
  return current;
}

export function themeColor(): ThemeColors {
  return current.color;
}

export function publishTheme(scheme: string | null | undefined): Theme {
  current = themeForScheme(scheme);
  return current;
}

/**
 * Light when the system scheme is light or unset. Dark only when the system
 * scheme is dark. Subscribes the caller so styles refresh on change.
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return useMemo(() => publishTheme(scheme), [scheme]);
}

/**
 * Rebuild module-level StyleSheets during render, after the theme is published.
 * `refresh` must assign the new sheet onto the binding components already read.
 */
export function useThemedStyles(refresh: () => void): void {
  const theme = useTheme();
  useMemo(() => {
    refresh();
    return theme;
  }, [theme, refresh]);
}

export { darkTheme, lightTheme, radius };
export type { Theme, ThemeColors };
