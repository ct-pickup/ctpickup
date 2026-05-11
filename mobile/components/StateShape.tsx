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
  CT: "M8.5,8.5 L91.5,8.5 L91.5,10 L89,48 L84,51 L80,57 L73,60 L68,54 L53,57 L38,54 L28,60 L20,57 L14,51 L11,48 L8.5,10 Z",
  NY: "M3,52 L5,45 L3,38 L8,28 L6,18 L14,8 L24,5 L32,8 L38,5 L48,3 L58,5 L65,3 L72,8 L80,12 L84,20 L82,30 L86,40 L80,50 L82,60 L74,68 L64,72 L54,80 L44,88 L36,80 L26,72 L16,64 L8,58 Z M64,72 L96,64 L95,74 L66,80 Z",
  NJ: "M33,4 L58,6 L64,16 L70,28 L72,42 L68,56 L60,68 L50,78 L40,84 L28,80 L20,68 L18,54 L22,40 L20,26 L26,14 Z",
  MD: "M4,42 L24,34 L40,28 L56,24 L70,22 L82,26 L94,36 L92,46 L78,52 L62,48 L50,56 L34,54 L18,60 L6,54 Z M70,22 L78,12 L86,14 L84,24 Z",
};

export default function StateShape({ state, size = 48, color, active = false }: Props) {
  const fill = color || (active ? "#a3e635" : "rgba(255,255,255,0.5)");
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={STATE_PATHS[state]} fill={fill} />
    </Svg>
  );
}
