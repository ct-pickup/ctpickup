import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAccountIntroReplay } from "@/context/AccountIntroReplayContext";

const LIME = "#a3e635";

type Props = {
  loading: boolean;
  scorePct: number | null;
  trackedPickups: number;
  attendedPickups?: number;
  onPress: () => void;
};

/** Pickup reliability score (same source as `/api/pickup/standing`). */
export function PickupScorePill({ loading, scorePct, trackedPickups, attendedPickups, onPress }: Props) {
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

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
    backgroundColor: "rgba(163,230,53,0.12)",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 68,
  },
  loading: {
    fontSize: 18,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
    letterSpacing: 2,
  },
  num: {
    fontSize: 17,
    fontWeight: "800",
    color: LIME,
    letterSpacing: -0.3,
  },
  placeholder: {
    fontSize: 17,
    fontWeight: "700",
    color: "rgba(255,255,255,0.45)",
  },
  denom: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 18,
    justifyContent: "flex-end",
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(18,18,18,0.98)",
    padding: 16,
  },
  sheetTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  sheetBody: { marginTop: 10, color: "rgba(255,255,255,0.68)", fontSize: 14.5, lineHeight: 21 },
  actions: { marginTop: 14, flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  secondaryBtnText: { color: "rgba(255,255,255,0.8)", fontWeight: "800" },
  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: LIME,
  },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "900" },
});
