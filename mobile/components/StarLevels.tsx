import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { headline, themeColor, useThemedStyles } from "@/theme";
import { STAR_LEVELS, starLevelFor, type StarLevel } from "@shared/starLevels";

function LevelRow({ level, selected, onPress }: { level: StarLevel; selected?: boolean; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.rowStar}>{level.star.toFixed(1)} ★</Text>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, selected && styles.rowNameOn]}>{level.name}</Text>
        {level.description ? <Text style={styles.rowDesc}>{level.description}</Text> : null}
      </View>
      {selected ? <FontAwesome name="check" size={14} color={themeColor().pitchText} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.row, styles.rowPick, selected && styles.rowOn, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
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
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <ScrollView contentContainerStyle={styles.list}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** "What do stars mean?" Lists every level; never shows scores or thresholds. */
export function StarLevelsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet
      visible={visible}
      title="What do stars mean?"
      subtitle="Your stars show the level you play at. They move as you play rated games."
      onClose={onClose}
    >
      {STAR_LEVELS.map((level) => (
        <LevelRow key={level.star} level={level} />
      ))}
    </Sheet>
  );
}

/** Small "What do stars mean?" link that opens the sheet. */
export function StarLevelsLink({ style, label = "What do stars mean?" }: { style?: StyleProp<ViewStyle>; label?: string }) {
  useThemedStyles(publish_styles);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        style={({ pressed }) => [styles.link, style, pressed && styles.pressed]}
      >
        <FontAwesome name="question-circle-o" size={14} color={themeColor().pitchText} />
        <Text style={styles.linkText}>{label}</Text>
      </Pressable>
      <StarLevelsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Select trigger plus a bottom sheet of levels with descriptions. */
export function StarLevelSelect({
  value,
  onChange,
  title = "What's the highest level you've played?",
  placeholder = "Choose your level…",
  invalid,
  minStar,
  style,
}: {
  value: number | null;
  onChange: (star: number) => void;
  title?: string;
  placeholder?: string;
  invalid?: boolean;
  /** Hide levels below this star (e.g. 1 hides "New"). */
  minStar?: number;
  style?: StyleProp<ViewStyle>;
}) {
  useThemedStyles(publish_styles);
  const [open, setOpen] = useState(false);
  const current = starLevelFor(value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.trigger, invalid && styles.triggerErr, style, pressed && styles.pressed]}
      >
        <Text style={current ? styles.triggerValue : styles.triggerPlaceholder} numberOfLines={1}>
          {current ? `${current.star.toFixed(1)} ★ ${current.name}` : placeholder}
        </Text>
        <FontAwesome name="caret-down" size={14} color={themeColor().muted} />
      </Pressable>
      <Sheet visible={open} title={title} onClose={() => setOpen(false)}>
        {STAR_LEVELS.filter((level) => minStar == null || level.star >= minStar).map((level) => (
          <LevelRow
            key={level.star}
            level={level}
            selected={current?.star === level.star}
            onPress={() => {
              onChange(level.star);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
    sheet: {
      maxHeight: "85%",
      backgroundColor: themeColor().bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: themeColor().overlay,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 10, backgroundColor: themeColor().overlay, marginBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    title: { flex: 1, color: themeColor().text, fontSize: 20, ...headline },
    subtitle: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 8 },
    list: { paddingTop: 12, paddingBottom: 8, gap: 4 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
    rowPick: { paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().card },
    rowOn: { borderColor: themeColor().pitchText, backgroundColor: themeColor().pitchPanel },
    rowStar: { width: 48, color: themeColor().text, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    rowText: { flex: 1 },
    rowName: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    rowNameOn: { color: themeColor().onPitchPanel },
    rowDesc: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 2 },
    link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
    linkText: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: themeColor().overlaySubtle,
    },
    triggerErr: { borderColor: themeColor().coral },
    triggerValue: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_400Regular" },
    triggerPlaceholder: { flex: 1, color: themeColor().muted, fontSize: 16, fontFamily: "Inter_400Regular" },
    pressed: { opacity: 0.85 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
