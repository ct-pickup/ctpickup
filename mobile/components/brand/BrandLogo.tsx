import { Image } from "expo-image";
import { StyleSheet } from "react-native";

import { PRODUCT_NAME } from "@/lib/brand";
import { themeColor, useThemedStyles } from "@/theme";

const SIZE = 96;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- static asset
const logo = require("@/assets/brand/ct-logo.png");

/** The real CT logo as a rounded square with a subtle border. Sits centered above the product title. */
export function BrandLogo({ size = SIZE }: { size?: number }) {
  useThemedStyles(publish_styles);
  return (
    <Image
      source={logo}
      style={[styles.logo, { width: size, height: size, borderRadius: size * 0.22 }]}
      contentFit="cover"
      alt={PRODUCT_NAME}
    />
  );
}

function make_styles() {
  return StyleSheet.create({
    logo: { borderWidth: 1, borderColor: themeColor().line, overflow: "hidden" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
