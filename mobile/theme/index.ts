import { useMemo } from "react";

import { useResolvedColorScheme } from "@/context/AppearanceContext";

import {
  darkTheme,
  lightTheme,
  palette,
  radius,
  themeForScheme,
  typeScale,
  type Theme,
  type ThemeColors,
} from "@theme/tokens";

/**
 * Headline face for every serif-style title. Swap this one line to change it,
 * e.g. { fontFamily: "InstrumentSerif_400Regular" } restores Instrument Serif.
 * The family file already carries the weight, so styles must not add fontWeight.
 */
export const headline = { fontFamily: "Archivo_700Bold", letterSpacing: -0.5 } as const;

/** Player name on the Profile hero: Archivo 700 at 28. */
export const profileName = { ...headline, fontSize: typeScale.profileName, lineHeight: 32 } as const;

/** Season record numeral ("2–1"). */
export const recordNumeral = { ...headline, fontSize: 40, lineHeight: 44 } as const;

/** Archivo display type for large numerals; tracking tightens with size so big scores stay compact. */
export function displayNumeral(size: number) {
  return {
    fontFamily: headline.fontFamily,
    fontSize: size,
    lineHeight: Math.round(size * 0.96),
    letterSpacing: -Math.round(size * 0.035 * 10) / 10,
  } as const;
}

/** Small tracked label for the share card (sentence case, never uppercased). */
export function trackedLabel(size: number) {
  return { fontFamily: "Inter_700Bold", fontSize: size, letterSpacing: Math.round(size * 0.06 * 10) / 10 } as const;
}

/**
 * Share card palette. The story image is always dark, whatever the app scheme,
 * so it reads the same on Instagram and in the camera roll.
 */
export const shareCardColor = {
  bg: darkTheme.color.bg,
  fallbackBg: darkTheme.color.pitchPanel,
  text: darkTheme.color.onPhoto,
  muted: "rgba(255,255,255,0.72)",
  faint: "rgba(255,255,255,0.22)",
  accent: darkTheme.color.accent,
  onAccent: darkTheme.color.onAccent,
  scrim: "#111111",
  starOff: "rgba(255,255,255,0.28)",
} as const;

/**
 * Profile player card palette. The card is ink in both schemes (and in the shared image),
 * so it uses dark-scheme colors whatever the app scheme.
 */
export const playerCardColor = {
  bg: palette.ink,
  name: palette.chalk,
  muted: darkTheme.color.muted,
  accent: palette.pitchBright,
  rule: shareCardColor.faint,
  chipBg: darkTheme.color.pitchPanel,
  chipText: darkTheme.color.onPitchPanel,
  chipLine: shareCardColor.faint,
  photoScrim: darkTheme.color.photoScrim,
} as const;

/** Opacity of the tiling noise texture (assets/grain.png) on photos and the player card. */
export const GRAIN_OPACITY = 0.07;

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
 * Theme for the user's Appearance setting (Light by default, Dark, or Match system).
 * Subscribes the caller so styles refresh on change.
 */
export function useTheme(): Theme {
  const scheme = useResolvedColorScheme();
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
