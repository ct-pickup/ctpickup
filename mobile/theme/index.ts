import { useMemo } from "react";
import { useColorScheme } from "react-native";

import {
  darkTheme,
  lightTheme,
  themeForScheme,
  type Theme,
  type ThemeColors,
} from "@theme/tokens";

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

export { darkTheme, lightTheme };
export type { Theme, ThemeColors };
