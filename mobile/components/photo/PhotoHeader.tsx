import { Image as CachedImage } from "expo-image";
import React from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { ChalkCenterCircle } from "@/components/chalk";
import type { ChalkSize } from "@/components/chalk/stroke";
import { themeColor, useTheme } from "@/theme";

const GRAIN = require("../../assets/grain.png");
const GRAIN_OPACITY = 0.07;
const FADE_HEIGHT = 32;

export type PhotoAspect = "wide" | "tall";

const RATIOS: Record<PhotoAspect, number> = { wide: 16 / 9, tall: 4 / 3 };

/**
 * Full-bleed photo with the shared treatment: grain overlay, and a bottom scrim
 * only when `children` (text) sit on the photo. Without a photo it renders a
 * pitchPanel block with a centered chalk circle; lists should skip the header
 * instead, so that fallback only shows on the session detail hero. Children
 * must use onPhoto.
 */
export default function PhotoHeader({
  uri,
  aspect = "wide",
  chalkSize = "sm",
  children,
  style,
  accessibilityLabel,
}: {
  uri?: string | null;
  aspect?: PhotoAspect;
  chalkSize?: ChalkSize;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  useTheme();
  const c = themeColor();

  return (
    <View
      style={[{ aspectRatio: RATIOS[aspect], backgroundColor: c.pitchPanel, overflow: "hidden" }, style]}
      accessible={Boolean(uri && accessibilityLabel)}
      accessibilityRole={uri ? "image" : undefined}
      accessibilityLabel={uri ? accessibilityLabel : undefined}
    >
      {uri ? (
        <>
          <CachedImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
          <Image
            source={GRAIN}
            resizeMode="repeat"
            style={[StyleSheet.absoluteFill, { opacity: GRAIN_OPACITY }]}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ChalkCenterCircle size={chalkSize} color="onPitchPanel" />
        </View>
      )}

      {children ? (
        <View style={styles.bottom} pointerEvents="box-none">
          <Svg width="100%" height={FADE_HEIGHT} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.photoScrim} stopOpacity={0} />
                <Stop offset="1" stopColor={c.photoScrim} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height={FADE_HEIGHT} fill="url(#photoFade)" />
          </Svg>
          <View style={[styles.band, { backgroundColor: c.photoScrim }]}>{children}</View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  band: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 },
});
