import { fmtPickupDtEt } from "@/lib/pickupPublic";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type FinalizeSlotSheetProps = {
  visible: boolean;
  busy: boolean;
  slots: Record<string, unknown>[];
  availability: Record<string, unknown>[];
  selectedSlotId: string;
  onSelectSlot: (slotId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function countAvailablePerSlot(availability: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of availability) {
    const slotId = s(row.slot_id).trim();
    if (!slotId) continue;
    const state = s(row.state).trim().toLowerCase();
    if (state !== "available") continue;
    counts.set(slotId, (counts.get(slotId) || 0) + 1);
  }
  return counts;
}

export default function FinalizeSlotSheet({
  visible,
  busy,
  slots,
  availability,
  selectedSlotId,
  onSelectSlot,
  onClose,
  onConfirm,
}: FinalizeSlotSheetProps) {
  const availBySlot = useMemo(() => countAvailablePerSlot(availability), [availability]);

  function onPressConfirm() {
    if (!selectedSlotId) {
      Alert.alert("Pick a slot", "Choose which kickoff time to finalize.");
      return;
    }
    onConfirm();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Finalize time slot</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <FontAwesome name="times" size={20} color="#fff" />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Pick the winning kickoff. Availability counts show who can make each time.</Text>
          {slots.length === 0 ? (
            <Text style={styles.hint}>No time slots on this run yet. Add slots from the web operator if needed.</Text>
          ) : (
            <ScrollView style={styles.slotList} showsVerticalScrollIndicator={false}>
              {slots.map((slot) => {
                const row = slot as Record<string, unknown>;
                const id = s(row.id);
                const startAt = s(row.start_at);
                const label = s(row.label);
                const active = selectedSlotId === id;
                const count = availBySlot.get(id) ?? 0;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      void hapticTap();
                      onSelectSlot(id);
                    }}
                    style={({ pressed }) => [
                      styles.slotRow,
                      active && styles.slotRowActive,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <View style={styles.slotRowTop}>
                      <Text style={[styles.slotRowTitle, active && styles.slotRowTitleActive]}>
                        {fmtPickupDtEt(startAt)}
                      </Text>
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{count} available</Text>
                      </View>
                    </View>
                    {label ? <Text style={styles.slotRowMeta}>{label}</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <Pressable
            disabled={busy || !selectedSlotId}
            onPress={() => {
              void hapticTap();
              onPressConfirm();
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              (!selectedSlotId || busy) && styles.primaryBtnDisabled,
              pressed && selectedSlotId && !busy && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.primaryBtnText}>{busy ? "Finalizing…" : "Confirm slot"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    maxHeight: "85%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.5)", lineHeight: 20, marginBottom: 12, fontSize: 13 },
  hint: { color: "rgba(255,255,255,0.5)", lineHeight: 20, marginBottom: 12 },
  slotList: { maxHeight: 320, marginBottom: 12 },
  slotRow: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 8,
  },
  slotRowActive: { borderColor: "rgba(163,230,53,0.5)", backgroundColor: "rgba(163,230,53,0.08)" },
  slotRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  slotRowTitle: { flex: 1, color: "#fff", fontWeight: "700", fontSize: 15 },
  slotRowTitleActive: { color: LIME },
  slotRowMeta: { color: "rgba(255,255,255,0.45)", marginTop: 6, fontSize: 13 },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  countBadgeText: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
