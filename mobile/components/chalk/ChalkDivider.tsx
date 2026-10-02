import React, { useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import { CHALK_STROKE, type ChalkColor, useChalkStroke } from "./stroke";

const HEIGHT = 12;
const MARK_R = 4;
const GAP = 4;

/** Section break: a chalk line with a small center-circle mark. */
export default function ChalkDivider({
  color = "line",
  style,
}: {
  color?: ChalkColor;
  style?: StyleProp<ViewStyle>;
}) {
  const stroke = useChalkStroke(color);
  const [width, setWidth] = useState(0);
  const c = width / 2;
  const y = HEIGHT / 2;
  return (
    <View
      style={[{ height: HEIGHT, alignSelf: "stretch" }, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={CHALK_STROKE} y1={y} x2={c - MARK_R - GAP} y2={y} {...stroke} />
          <Circle cx={c} cy={y} r={MARK_R} {...stroke} />
          <Line x1={c + MARK_R + GAP} y1={y} x2={width - CHALK_STROKE} y2={y} {...stroke} />
        </Svg>
      ) : null}
    </View>
  );
}
