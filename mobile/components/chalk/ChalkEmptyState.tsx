import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";

import ChalkBox from "./ChalkBox";
import ChalkCenterCircle from "./ChalkCenterCircle";
import type { ChalkSize } from "./stroke";

export default function ChalkEmptyState({
  graphic = "box",
  size = "md",
  title,
  body,
  actionLabel,
  onAction,
  style,
}: {
  graphic?: "box" | "circle";
  size?: ChalkSize;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  useThemedStyles(publish_styles);

  return (
    <View style={[styles.root, style]}>
      {graphic === "circle" ? <ChalkCenterCircle size={size} /> : <ChalkBox size={size} />}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 16, gap: 8 },
    title: {
      marginTop: 8,
      fontSize: 24,
      fontFamily: "InstrumentSerif_400Regular",
      color: themeColor().text,
      textAlign: "center",
    },
    body: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      lineHeight: 20,
      color: themeColor().muted,
      textAlign: "center",
    },
    action: {
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: themeColor().pitch,
    },
    actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().pitchText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
