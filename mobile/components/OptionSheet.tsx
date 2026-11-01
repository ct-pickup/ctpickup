import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { headline, themeColor, useThemedStyles } from "@/theme";

export type SheetOption<T extends string> = { value: T; label: string };

/** A small bottom sheet that lists options and marks the selected one. Tapping an option selects it and closes the sheet. */
export function OptionSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ReadonlyArray<SheetOption<T>>;
  selected: T | null;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <FontAwesome name="close" size={18} color={themeColor().muted} />
            </Pressable>
          </View>
          {options.map((o) => {
            const on = o.value === selected;
            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onSelect(o.value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.rowText, on && styles.rowTextOn]}>{o.label}</Text>
                {on ? <FontAwesome name="check" size={14} color={themeColor().pitchText} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 8 },
    handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.line, marginBottom: 10 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    title: { color: c.text, fontSize: 18, ...headline },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    rowText: { color: c.text, fontSize: 16, fontFamily: "Inter_500Medium" },
    rowTextOn: { color: c.pitchText, fontFamily: "Inter_700Bold", fontWeight: "700" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
