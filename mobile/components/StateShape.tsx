import React from "react";
import Svg, { Path } from "react-native-svg";

type StateCode = "CT" | "NY" | "NJ" | "MD";

type Props = {
  state: StateCode;
  size?: number;
  color?: string;
  active?: boolean;
};

const STATE_PATHS: Record<StateCode, string> = {
  CT: "M10,20 L90,20 L88,55 L80,58 L75,65 L60,68 L55,62 L40,65 L30,60 L20,65 L12,58 Z",
  NY: "M5,40 L10,20 L20,10 L35,8 L40,15 L55,10 L70,5 L80,15 L85,25 L80,35 L85,50 L75,60 L65,65 L55,72 L45,80 L35,72 L25,65 L15,55 Z M65,65 L95,58 L93,68 L68,72 Z",
  NJ: "M35,5 L60,8 L65,18 L70,32 L68,48 L62,60 L52,72 L42,80 L30,75 L22,62 L24,48 L20,32 L25,18 Z",
  MD: "M5,38 L30,30 L48,24 L65,22 L80,26 L92,36 L88,46 L72,50 L58,46 L48,54 L32,52 L16,58 L6,50 Z M65,22 L75,12 L82,14 L80,24 Z",
};

export default function StateShape({ state, size = 48, color, active = false }: Props) {
  const fill = color || (active ? "#a3e635" : "rgba(255,255,255,0.5)");
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={STATE_PATHS[state]} fill={fill} />
    </Svg>
  );
}
