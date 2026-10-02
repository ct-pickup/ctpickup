import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAccountIntroReplay } from "@/context/AccountIntroReplayContext";

import { headline, themeColor, useThemedStyles } from "@/theme";
type Props = {
  loading: boolean;
  scorePct: number | null;
  trackedPickups: number;
  attendedPickups?: number;
  onPress: () => void;
};

/** Pickup reliability score (same source as `/api/pickup/standing`). */
export function PickupScorePill({ loading, scorePct, trackedPickups, attendedPickups, onPress }: Props) {
  useThemedStyles(publish_styles);

  const { replay } = useAccountIntroReplay();
  const [open, setOpen] = useState(false);

  const attended = typeof attendedPickups === "number" ? attendedPickups : null;
  const ratingLine = useMemo(() => {
    if (loading) return "Pickup reliability";
    if (scorePct == null) return "Pickup rating is still building";
    return `Pickup reliability: ${scorePct}/100`;
  }, [loading, scorePct]);

  const a11y = loading
    ? "Loading pickup reliability score"
    : scorePct != null
      ? `Pickup reliability score ${scorePct} out of 100`
      : `Pickup reliability score not shown yet, ${trackedPickups} tracked pickups. Score starts after three pickups.`;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Shows score details. Long-press opens account."
        onPress={() => setOpen(true)}
        onLongPress={onPress}
        delayLongPress={350}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
      >
        {loading ? (
          <Text style={styles.loading}>…</Text>
        ) : scorePct != null ? (
          <Text>
            <Text style={styles.num}>{scorePct}</Text>
            <Pressable
              onPress={() => {
                if (!__DEV__) return;
                void replay({ trackedPickups, scorePct });
              }}
              accessibilityRole={__DEV__ ? "button" : undefined}
              accessibilityLabel={__DEV__ ? "Replay account intro (dev only)" : undefined}
              hitSlop={10}
            >
              <Text style={styles.denom}>/100</Text>
            </Pressable>
          </Text>
        ) : (
          <Text>
            <Text style={styles.placeholder}>—</Text>
            <Pressable
              onPress={() => {
                if (!__DEV__) return;
                void replay({ trackedPickups, scorePct });
              }}
              accessibilityRole={__DEV__ ? "button" : undefined}
              accessibilityLabel={__DEV__ ? "Replay account intro (dev only)" : undefined}
              hitSlop={10}
            >
              <Text style={styles.denom}>/100</Text>
            </Pressable>
          </Text>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => null}>
            <Text style={styles.sheetTitle}>{ratingLine}</Text>
            <Text style={styles.sheetBody}>
              {attended != null ? `Sessions attended: ${attended}. ` : ""}
              Tracked sessions: {trackedPickups}. Score starts after 3 tracked sessions.
            </Text>
            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={onPress}>
                <Text style={styles.secondaryBtnText}>Open account</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => setOpen(false)}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 68,
  },
  loading: {
    fontSize: 20, ...headline,
    color: themeColor().muted,
  },
  num: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  placeholder: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
  },
  denom: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: themeColor().scrim,
    padding: 16,
    justifyContent: "flex-end",
  },
  sheet: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().bg,
    padding: 16,
  },
  sheetTitle: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "900" },
  sheetBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  actions: { marginTop: 12, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  secondaryBtnText: { color: themeColor().text, fontWeight: "800" },
  primaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: themeColor().pitch,
  },
  primaryBtnText: { color: themeColor().onPitch, fontWeight: "900" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

