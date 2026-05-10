import React from "react";
import Svg, { Path } from "react-native-svg";

type StateCode = "CT" | "NY" | "NJ" | "MD";

type Props = {
  state: StateCode;
  size?: number;
  color?: string;
  active?: boolean;
};

// Accurate simplified SVG silhouettes for each state
const STATE_PATHS: Record<StateCode, string> = {
  // Connecticut - roughly rectangular with slight irregularities
  CT: "M15,10 L85,10 L87,45 L82,48 L78,55 L70,58 L65,52 L50,55 L35,52 L25,58 L18,55 L13,48 Z",
  
  // New York - distinctive shape with Long Island
  NY: "M8,15 L25,8 L35,12 L55,8 L65,5 L78,18 L82,30 L75,42 L80,55 L72,65 L60,70 L50,78 L38,72 L28,65 L18,55 L12,42 L8,28 Z M65,72 L95,65 L95,75 L70,80 Z",

  // New Jersey - elongated diamond-ish shape  
  NJ: "M38,5 L62,8 L68,20 L72,35 L70,50 L65,62 L55,75 L45,82 L32,78 L22,65 L20,50 L25,35 L28,20 Z",

  // Maryland - distinctive shape with Eastern Shore
  MD: "M5,35 L35,28 L50,22 L68,20 L82,25 L92,35 L88,45 L75,48 L62,44 L52,52 L38,50 L22,58 L8,52 Z M68,20 L78,10 L85,12 L82,22 Z",
};

export default function StateShape({ state, size = 48, color, active = false }: Props) {
  const fill = color || (active ? "#a3e635" : "rgba(255,255,255,0.5)");
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={STATE_PATHS[state]} fill={fill} />
    </Svg>
  );
}
