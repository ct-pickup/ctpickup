/**
 * Competitive Together theme. Single source of truth for color, type, and radius.
 * Light is the default. Dark values apply when the user picks Dark, or Match system on a dark phone.
 * Hex and rgba belong in this file only.
 */

export const palette = {
  /** Brand cyan (logo). Buttons, fills, highlights, icons and selected states. Text and icons on it are always `ink`. */
  cyan: "#14E4FC",
  /** Primary text, and every dark surface and card. */
  ink: "#0B1218",
  /** Cyan used as text, links or thin lines on light backgrounds. */
  cyanDeep: "#0891B2",
  /** App background. */
  bg: "#F5F8FA",
  card: "#FFFFFF",
  border: "#E1E8ED",
  muted: "#5B6B76",
  /** Wins, W badges and confirmations. */
  success: "#16A34A",
  warning: "#F59E0B",
  error: "#EF4444",
  /** CT+ premium card accent only. */
  gold: "#C9A24B",
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
  /** Primary fill (the name is kept from the old green so call sites stay): brand cyan. Text on it is `onPitch` (ink). */
  pitch: string;
  /** Brand cyan used as text, link or thin line: deep cyan on light backgrounds, brand cyan on dark. */
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
  /** Text and icons on a pitch (brand cyan) fill. Always ink, never white. */
  onPitch: string;
  /** Dark surface (ink) for cards and panels that were dark green. White text (`onInk`) and cyan accents sit on it. */
  inkSurface: string;
  /** Text and icons on inkSurface. */
  onInk: string;
  success: string;
  warning: string;
  error: string;
  overlaySubtle: string;
  overlay: string;
  overlayStrong: string;
  scrim: string;
  /** Band under text on photos. Dark enough that onPhoto passes 4.5:1 even over a white photo. */
  photoScrim: string;
  /** Text and icons on photoScrim. */
  onPhoto: string;
};

/** Semantic colors. `bg` is the light background in light and ink in dark. */
export const lightColor: ThemeColors = {
  bg: palette.bg,
  card: palette.card,
  text: palette.ink,
  muted: palette.muted,
  line: palette.border,
  pitch: palette.cyan,
  pitchText: palette.cyanDeep,
  pitchSoft: "rgba(20,228,252,0.14)",
  accent: palette.cyan,
  onAccent: palette.ink,
  pitchPanel: "rgba(20,228,252,0.14)",
  onPitchPanel: palette.ink,
  coral: palette.error,
  coralText: palette.error,
  onPitch: palette.ink,
  inkSurface: palette.ink,
  onInk: palette.card,
  success: palette.success,
  warning: palette.warning,
  error: palette.error,
  overlaySubtle: "rgba(11,18,24,0.04)",
  overlay: "rgba(11,18,24,0.08)",
  overlayStrong: "rgba(11,18,24,0.14)",
  scrim: "rgba(11,18,24,0.45)",
  photoScrim: "rgba(11,18,24,0.72)",
  onPhoto: palette.card,
};

export const darkColor: ThemeColors = {
  bg: palette.ink,
  card: "rgba(255,255,255,0.06)",
  text: palette.card,
  muted: "rgba(255,255,255,0.64)",
  line: "rgba(255,255,255,0.14)",
  pitch: palette.cyan,
  pitchText: palette.cyan,
  pitchSoft: "rgba(20,228,252,0.16)",
  accent: palette.cyan,
  onAccent: palette.ink,
  pitchPanel: "rgba(20,228,252,0.16)",
  onPitchPanel: palette.card,
  coral: palette.error,
  coralText: palette.error,
  onPitch: palette.ink,
  inkSurface: palette.ink,
  onInk: palette.card,
  success: palette.success,
  warning: palette.warning,
  error: palette.error,
  overlaySubtle: "rgba(255,255,255,0.04)",
  overlay: "rgba(255,255,255,0.08)",
  overlayStrong: "rgba(255,255,255,0.14)",
  scrim: "rgba(0,0,0,0.55)",
  photoScrim: "rgba(11,18,24,0.72)",
  onPhoto: palette.card,
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
