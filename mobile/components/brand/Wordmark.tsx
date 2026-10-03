import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";

import { PRODUCT_NAME } from "@/lib/brand";
import { headline, themeColor } from "@/theme";

type WordmarkProps = {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  onLongPress?: TextProps["onLongPress"];
  numberOfLines?: number;
  allowFontScaling?: boolean;
  /** Shrink to stay on one line rather than truncate. */
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
};

/** "Competitive Together" in Archivo 700. */
export function Wordmark({
  size = 20,
  color,
  style,
  onLongPress,
  numberOfLines = 1,
  allowFontScaling,
  adjustsFontSizeToFit,
  minimumFontScale,
}: WordmarkProps) {
  return (
    <Text
      accessibilityLabel={PRODUCT_NAME}
      numberOfLines={numberOfLines}
      allowFontScaling={allowFontScaling}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
      onLongPress={onLongPress}
      style={[
        { fontFamily: headline.fontFamily, fontSize: size, lineHeight: Math.round(size * 1.2), color: color ?? themeColor().text },
        style,
      ]}
    >
      {PRODUCT_NAME}
    </Text>
  );
}
