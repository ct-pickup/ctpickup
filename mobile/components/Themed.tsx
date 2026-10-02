import { Text as DefaultText, View as DefaultView } from "react-native";

import { useTheme } from "@/theme";

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText["props"];
export type ViewProps = ThemeProps & DefaultView["props"];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: "text" | "background",
) {
  const { color, mode } = useTheme();
  const override = mode === "dark" ? props.dark : props.light;
  if (override) return override;
  return colorName === "background" ? color.bg : color.text;
}

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, "text");
  return <DefaultText style={[{ color }, style]} {...otherProps} />;
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, "background");
  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}
