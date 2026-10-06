import Svg, { Circle, Line, Polyline } from "react-native-svg";

import { themeColor } from "@/theme";

/** A bare line chart of a 0..1 series: no axes and no numbers. */
export default function RatingTrend({
  shape,
  seasonBreaks = [],
  width = 300,
  height = 90,
}: {
  shape: readonly number[];
  /** Indexes in `shape` where a new season starts: drawn as faint dividers when the line spans several seasons. */
  seasonBreaks?: readonly number[];
  width?: number;
  height?: number;
}) {
  const pad = 8;
  const step = (width - pad * 2) / Math.max(1, shape.length - 1);
  const pts = shape.map((v, i) => [pad + i * step, pad + (1 - v) * (height - pad * 2)] as const);
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height} accessibilityLabel="Rating trend over your rated games">
      {seasonBreaks.map((i) => {
        const x = pad + i * step;
        return <Line key={i} x1={x} x2={x} y1={pad} y2={height - pad} stroke={themeColor().line} strokeWidth={1} strokeDasharray="3,3" />;
      })}
      <Polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={themeColor().pitch} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <Circle cx={last[0]} cy={last[1]} r={4} fill={themeColor().pitch} /> : null}
    </Svg>
  );
}
