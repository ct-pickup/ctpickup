/**
 * Competitive Together theme. Single source of truth for color, type, and radius.
 * Light is the default. Dark values apply when the user picks Dark, or Match system on a dark phone.
 * Hex and rgba belong in this file only.
 */

export const palette = {
  chalk: "#F4F1EA",
  paper: "#FFFFFF",
  ink: "#111111",
  inkCard: "#1A1A1A",
  pitch: "#1F4D3A",
  pitchSoft: "#E3ECE6",
  /** Dark mode accent only. Never on light surfaces. */
  pitchBright: "#6FD3A0",
  coral: "#FF6B4A",
  coralDeep: "#B33A1E",
  pitchPanelDark: "#1C2E25",
  onPitchPanelDark: "#A9CDB8",
  mutedLight: "#6B6B66",
  mutedDark: "#A3A39E",
  lineLight: "#E2DED4",
  lineDark: "#2A2A2A",
} as const;

export const radius = {
  card: 12,
  button: 10,
  /** Profile player card. */
  playerCard: 16,
  pill: 999,
} as const;

/** 4pt spacing grid. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const typeScale = {
  /** Hero moments only: not-found, onboarding, first-100 intro. */
  displayXL: 56,
  display: 40,
  h1: 32,
  /** Player name on the Profile hero. */
  profileName: 28,
  h2: 24,
  h3: 20,
  body: 16,
  small: 14,
  caption: 13,
  /** Badges, pills and chips only. Never body text. */
  micro: 11,
} as const;

export const fontFamily = {
  serif: "InstrumentSerif_400Regular",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemibold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
} as const;

export type ThemeColors = {
  bg: string;
  card: string;
  text: string;
  muted: string;
  line: string;
  pitch: string;
  /** Pitch used as text or icon color. Pitch in light; pitch-soft in dark so it stays readable on ink. */
  pitchText: string;
  pitchSoft: string;
  /** Interactive accent: + button, outline buttons, links, active tab, Open dot. Pitch in light; pitchBright in dark. */
  accent: string;
  /** Text and icons on an accent fill. Paper in light; ink in dark. */
  onAccent: string;
  /** Tinted panel surface. Pitch-soft in light; deep green in dark so it does not glow. */
  pitchPanel: string;
  /** Text and icons on a pitchPanel surface. */
  onPitchPanel: string;
  /** Coral for fills, borders and dots. Urgency and errors only. */
  coral: string;
  /** Coral used as text. Deeper in light so small text stays readable on chalk. */
  coralText: string;
  onPitch: string;
  overlaySubtle: string;
  overlay: string;
  overlayStrong: string;
  scrim: string;
  /** Band under text on photos. Dark enough that onPhoto passes 4.5:1 even over a white photo. */
  photoScrim: string;
  /** Text and icons on photoScrim. */
  onPhoto: string;
};

/** Semantic colors. `bg` is chalk in light and ink in dark. */
export const lightColor: ThemeColors = {
  bg: palette.chalk,
  card: palette.paper,
  text: palette.ink,
  muted: palette.mutedLight,
  line: palette.lineLight,
  pitch: palette.pitch,
  pitchText: palette.pitch,
  pitchSoft: palette.pitchSoft,
  accent: palette.pitch,
  onAccent: palette.paper,
  pitchPanel: palette.pitchSoft,
  onPitchPanel: palette.pitch,
  coral: palette.coral,
  coralText: palette.coralDeep,
  onPitch: palette.paper,
  overlaySubtle: "rgba(17,17,17,0.04)",
  overlay: "rgba(17,17,17,0.08)",
  overlayStrong: "rgba(17,17,17,0.14)",
  scrim: "rgba(17,17,17,0.45)",
  photoScrim: "rgba(17,17,17,0.72)",
  onPhoto: palette.paper,
};

export const darkColor: ThemeColors = {
  bg: palette.ink,
  card: palette.inkCard,
  text: palette.chalk,
  muted: palette.mutedDark,
  line: palette.lineDark,
  pitch: palette.pitch,
  pitchText: palette.pitchSoft,
  pitchSoft: palette.pitchSoft,
  accent: palette.pitchBright,
  onAccent: palette.ink,
  pitchPanel: palette.pitchPanelDark,
  onPitchPanel: palette.onPitchPanelDark,
  coral: palette.coral,
  coralText: palette.coral,
  onPitch: palette.paper,
  overlaySubtle: "rgba(255,255,255,0.04)",
  overlay: "rgba(255,255,255,0.08)",
  overlayStrong: "rgba(255,255,255,0.14)",
  scrim: "rgba(0,0,0,0.55)",
  photoScrim: "rgba(17,17,17,0.72)",
  onPhoto: palette.paper,
};

export type Theme = {
  mode: "light" | "dark";
  color: ThemeColors;
  radius: typeof radius;
  space: typeof space;
  typeScale: typeof typeScale;
  fontFamily: typeof fontFamily;
};

export const lightTheme: Theme = {
  mode: "light",
  color: lightColor,
  radius,
  space,
  typeScale,
  fontFamily,
};

export const darkTheme: Theme = {
  mode: "dark",
  color: darkColor,
  radius,
  space,
  typeScale,
  fontFamily,
};

export function themeForScheme(scheme: string | null | undefined): Theme {
  return scheme === "dark" ? darkTheme : lightTheme;
}

const TYPE_STEPS = [
  typeScale.caption,
  typeScale.small,
  typeScale.body,
  typeScale.h3,
  typeScale.h2,
  typeScale.h1,
  typeScale.display,
] as const;

/** Nearest step on the type scale. Exact ties round to the larger step. */
export function snapTypeSize(px: number): number {
  let best: number = TYPE_STEPS[0];
  let bestDist = Infinity;
  for (const step of TYPE_STEPS) {
    const dist = Math.abs(step - px);
    if (dist < bestDist || (dist === bestDist && step > best)) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

export function fontFamilyFor(size: number, weight?: string | number | null): string {
  if (size >= typeScale.h3) return fontFamily.serif;
  const w = String(weight ?? "400");
  if (w === "500" || w === "medium") return fontFamily.sansMedium;
  if (w === "600" || w === "semibold") return fontFamily.sansSemibold;
  if (w === "700" || w === "800" || w === "900" || w === "bold") return fontFamily.sansBold;
  return fontFamily.sans;
}

export function snapRadius(px: number): number {
  if (px >= 20) return radius.pill;
  if (px <= 11) return radius.button;
  return radius.card;
}
