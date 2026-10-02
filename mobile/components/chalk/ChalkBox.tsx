import React from "react";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { CHALK_STROKE, type ChalkColor, type ChalkSize, useChalkStroke } from "./stroke";

const WIDTHS: Record<ChalkSize, number> = { sm: 72, md: 120, lg: 200 };

/** Penalty box seen from above: goal line, penalty area, six-yard box and penalty spot. */
export default function ChalkBox({
  size = "md",
  color = "line",
}: {
  size?: ChalkSize;
  color?: ChalkColor;
}) {
  const stroke = useChalkStroke(color);
  const w = WIDTHS[size];
  const h = w * 0.6;
  const top = CHALK_STROKE;
  const box = { x: w * 0.12, w: w * 0.76, h: h * 0.82 };
  const six = { x: w * 0.32, w: w * 0.36, h: h * 0.3 };
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} accessible={false}>
      <Line x1={top} y1={top} x2={w - top} y2={top} {...stroke} />
      <Path d={`M ${box.x} ${top} V ${box.h} H ${box.x + box.w} V ${top}`} {...stroke} />
      <Path d={`M ${six.x} ${top} V ${six.h} H ${six.x + six.w} V ${top}`} {...stroke} />
      <Circle cx={w / 2} cy={h * 0.56} r={CHALK_STROKE} {...stroke} />
    </Svg>
  );
}
