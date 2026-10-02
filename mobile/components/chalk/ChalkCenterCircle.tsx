import React from "react";
import Svg, { Circle, Line } from "react-native-svg";

import { CHALK_STROKE, type ChalkColor, type ChalkSize, useChalkStroke } from "./stroke";

const SIZES: Record<ChalkSize, number> = { sm: 48, md: 96, lg: 160 };

/** Center circle with the halfway line through it and the center spot. */
export default function ChalkCenterCircle({
  size = "md",
  color = "line",
  px,
  dark = false,
}: {
  size?: ChalkSize;
  color?: ChalkColor;
  /** Exact width in points for rendered images; the stroke scales with it. */
  px?: number;
  /** Always use dark-scheme colors (share card). */
  dark?: boolean;
}) {
  const s = px ?? SIZES[size];
  const strokeWidth = px ? Math.max(CHALK_STROKE, Math.round((px / SIZES.lg) * CHALK_STROKE * 10) / 10) : CHALK_STROKE;
  const stroke = useChalkStroke(color, { dark, width: strokeWidth });
  const c = s / 2;
  const inset = strokeWidth;
  const r = s * 0.36;
  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} accessible={false}>
      <Line x1={inset} y1={c} x2={s - inset} y2={c} {...stroke} />
      <Circle cx={c} cy={c} r={r} {...stroke} />
      <Circle cx={c} cy={c} r={strokeWidth} {...stroke} />
    </Svg>
  );
}
