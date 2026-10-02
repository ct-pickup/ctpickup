import Svg, { Path, Rect } from "react-native-svg";

import { SHORT_NAME } from "@/lib/brand";
import { darkTheme, lightTheme, themeNow } from "@/theme";

import { MONOGRAM_PATH, MONOGRAM_RADIUS, MONOGRAM_VIEWBOX } from "./monogramPath";

type MonogramProps = {
  size?: number;
  /** light: pitch on chalk. dark: chalk on ink. auto follows the app theme. */
  variant?: "light" | "dark" | "auto";
  /** Draw the rounded tile behind the letters. Off for letters only. */
  tile?: boolean;
  /** Overrides the letter colour, e.g. on the always-dark share card. */
  color?: string;
};

export function Monogram({ size = 32, variant = "auto", tile = true, color }: MonogramProps) {
  const dark = variant === "dark" || (variant === "auto" && themeNow().mode === "dark");
  const bg = dark ? darkTheme.color.bg : lightTheme.color.bg;
  const fg = color ?? (dark ? darkTheme.color.text : lightTheme.color.pitch);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${MONOGRAM_VIEWBOX} ${MONOGRAM_VIEWBOX}`}
      accessibilityRole="image"
      accessibilityLabel={SHORT_NAME}
    >
      {tile ? <Rect width={MONOGRAM_VIEWBOX} height={MONOGRAM_VIEWBOX} rx={MONOGRAM_RADIUS} fill={bg} /> : null}
      <Path d={MONOGRAM_PATH} fill={fg} />
    </Svg>
  );
}
