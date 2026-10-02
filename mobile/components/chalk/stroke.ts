import { useTheme } from "@/theme";

export const CHALK_STROKE = 1.5;

export type ChalkColor = "line" | "pitchText" | "onPitchPanel";

export type ChalkSize = "sm" | "md" | "lg";

/** Chalk strokes are never filled and never faded: one width, round caps, a token color. */
export function useChalkStroke(color: ChalkColor = "line") {
  const theme = useTheme();
  return {
    stroke: theme.color[color],
    strokeWidth: CHALK_STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
}
