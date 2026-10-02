import React from "react";
import Svg, { Circle, Line } from "react-native-svg";

import { CHALK_STROKE, type ChalkColor, type ChalkSize, useChalkStroke } from "./stroke";

const SIZES: Record<ChalkSize, number> = { sm: 48, md: 96, lg: 160 };

/** Center circle with the halfway line through it and the center spot. */
export default function ChalkCenterCircle({
  size = "md",
  color = "line",
}: {
  size?: ChalkSize;
  color?: ChalkColor;
}) {
  const stroke = useChalkStroke(color);
  const s = SIZES[size];
  const c = s / 2;
  const inset = CHALK_STROKE;
  const r = s * 0.36;
  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} accessible={false}>
      <Line x1={inset} y1={c} x2={s - inset} y2={c} {...stroke} />
      <Circle cx={c} cy={c} r={r} {...stroke} />
      <Circle cx={c} cy={c} r={CHALK_STROKE} {...stroke} />
    </Svg>
  );
}
