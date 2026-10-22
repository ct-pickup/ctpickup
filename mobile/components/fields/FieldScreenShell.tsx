import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { goBack } from "@/lib/goBack";
import { themeColor, useThemedStyles } from "@/theme";

/** Page chrome shared by the field screens: safe-area top, a Back pill, scrolling body, optional pinned footer. */
export function FieldScreenShell({ fallback, children, footer }: { fallback: Href; children: ReactNode; footer?: ReactNode }) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable onPress={() => goBack(router, fallback)} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.backText}>{"‹"} Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>{footer}</View> : <View style={{ height: insets.bottom }} />}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    back: { marginLeft: 12, marginTop: 4, alignSelf: "flex-start", backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.line },
    backText: { color: c.text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    content: { padding: 20, gap: 16 },
    footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: c.bg },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
