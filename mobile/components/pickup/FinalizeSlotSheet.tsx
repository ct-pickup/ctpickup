import DateTimePicker, { isScheduleWallMidnightEt } from "@/components/DateTimePicker";
import { fmtPickupSlotChipEt } from "@/lib/pickupPublic";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo, useState } from "react";
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
  onConfirmSlot: (slotId: string) => void;
  onConfirmCustom: (startAtIso: string) => void;
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
  onConfirmSlot,
  onConfirmCustom,
}: FinalizeSlotSheetProps) {
  const availBySlot = useMemo(() => countAvailablePerSlot(availability), [availability]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStartAt, setCustomStartAt] = useState("");

  const popularSlotId = useMemo(() => {
    let bestId = "";
    let bestCount = -1;
    for (const slot of slots) {
      const id = s((slot as Record<string, unknown>).id);
      const c = availBySlot.get(id) ?? 0;
      if (c > bestCount) {
        bestCount = c;
        bestId = id;
      }
    }
    return bestCount > 0 ? bestId : "";
  }, [slots, availBySlot]);

  function slotLine(slot: Record<string, unknown>): string {
    const startAt = s(slot.start_at);
    const label = s(slot.label).trim();
    const id = s(slot.id);
    const count = availBySlot.get(id) ?? 0;
    const when = label || fmtPickupSlotChipEt(startAt);
    return `${when} — ${count} player${count === 1 ? "" : "s"} available`;
  }

  function onPressUseSlot(slotId: string) {
    if (!slotId) return;
    void hapticTap();
    onSelectSlot(slotId);
    Alert.alert(
      "Use this time?",
      "This closes the poll and sets the run kickoff. Players who did not pick this slot may not be eligible to confirm.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Use this time", onPress: () => onConfirmSlot(slotId) },
      ],
    );
  }

  function onPressCustomConfirm() {
    const picked = customStartAt.trim();
    if (!picked) {
      Alert.alert("Pick a time", "Choose a custom kickoff date and time.");
      return;
    }
    if (isScheduleWallMidnightEt(picked)) {
      Alert.alert("Pick a time", "Choose a real start time, not midnight.");
      return;
    }
    if (new Date(picked) <= new Date()) {
      Alert.alert("Future only", "Kickoff must be in the future.");
      return;
    }
    Alert.alert(
      "Use custom time?",
      "This overrides the availability poll and finalizes the run at your chosen time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            setCustomOpen(false);
            onConfirmCustom(picked);
          },
        },
      ],
    );
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
          <Text style={styles.subtitle}>
            Pick the winning kickoff from player votes, or set a custom time.
          </Text>
          {slots.length === 0 ? (
            <Text style={styles.hint}>No time slots on this run yet.</Text>
          ) : (
            <ScrollView style={styles.slotList} showsVerticalScrollIndicator={false}>
              {slots.map((slot) => {
                const row = slot as Record<string, unknown>;
                const id = s(row.id);
                const active = selectedSlotId === id;
                const isPopular = popularSlotId === id && (availBySlot.get(id) ?? 0) > 0;
                return (
                  <View
                    key={id}
                    style={[styles.slotRow, active && styles.slotRowActive, isPopular && styles.slotRowPopular]}
                  >
                    {isPopular ? (
                      <Text style={styles.popularBadge}>Most votes</Text>
                    ) : null}
                    <Text style={[styles.slotRowTitle, (active || isPopular) && styles.slotRowTitleActive]}>
                      {slotLine(row)}
                    </Text>
                    <Pressable
                      disabled={busy}
                      onPress={() => onPressUseSlot(id)}
                      style={({ pressed }) => [styles.useBtn, pressed && { opacity: 0.9 }, busy && { opacity: 0.55 }]}
                    >
                      <Text style={styles.useBtnText}>Use this time</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <Pressable
            onPress={() => {
              void hapticTap();
              setCustomOpen((o) => !o);
            }}
            style={({ pressed }) => [styles.customToggle, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.customToggleText}>Use custom time</Text>
            <FontAwesome name={customOpen ? "chevron-up" : "chevron-down"} size={14} color="rgba(255,255,255,0.5)" />
          </Pressable>

          {customOpen ? (
            <View style={styles.customBlock}>
              <DateTimePicker
                label="Custom kickoff (ET)"
                value={customStartAt}
                onChange={setCustomStartAt}
                enforceFuture
              />
              <Pressable
                disabled={busy}
                onPress={() => {
                  void hapticTap();
                  onPressCustomConfirm();
                }}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  busy && styles.primaryBtnDisabled,
                  pressed && !busy && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{busy ? "Finalizing…" : "Confirm custom time"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.5)", lineHeight: 20, marginBottom: 12, fontSize: 13 },
  hint: { color: "rgba(255,255,255,0.5)", lineHeight: 20, marginBottom: 12 },
  slotList: { maxHeight: 340, marginBottom: 12 },
  slotRow: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 8,
  },
  slotRowActive: { borderColor: "rgba(163,230,53,0.35)", backgroundColor: "rgba(163,230,53,0.05)" },
  slotRowPopular: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.1)" },
  popularBadge: {
    color: LIME,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  slotRowTitle: { color: "#fff", fontWeight: "600", fontSize: 14, lineHeight: 20, marginBottom: 10 },
  slotRowTitleActive: { color: LIME },
  useBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: LIME,
  },
  useBtnText: { color: "#111", fontWeight: "800", fontSize: 13 },
  customToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
    marginTop: 4,
  },
  customToggleText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 14 },
  customBlock: { marginTop: 8, gap: 12 },
  primaryBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
