import DateTimePicker from "@/components/DateTimePicker";
import { fmtPickupDtEt } from "@/lib/pickupPublic";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export type EditRunSheetProps = {
  visible: boolean;
  busy: boolean;
  initialStartAt: string;
  initialCapacity: number;
  initialFeeCents: number;
  statusLabel: string;
  onClose: () => void;
  onSave: (payload: { start_at: string; capacity: number; fee_cents: number }) => void;
};

export default function EditRunSheet({
  visible,
  busy,
  initialStartAt,
  initialCapacity,
  initialFeeCents,
  statusLabel,
  onClose,
  onSave,
}: EditRunSheetProps) {
  useThemedStyles(publish_styles);

  const [startAt, setStartAt] = useState(initialStartAt);
  const [capacity, setCapacity] = useState(String(initialCapacity));
  const [feeDollars, setFeeDollars] = useState(((initialFeeCents || 0) / 100).toFixed(2));

  useEffect(() => {
    if (!visible) return;
    setStartAt(initialStartAt);
    setCapacity(String(initialCapacity));
    setFeeDollars(((initialFeeCents || 0) / 100).toFixed(2));
  }, [visible, initialStartAt, initialCapacity, initialFeeCents]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Edit run</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <FontAwesome name="times" size={20} color={themeColor().text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <DateTimePicker label="Date & time (ET)" value={startAt} onChange={setStartAt} prominent />
            <Text style={styles.label}>Capacity</Text>
            <TextInput
              style={styles.input}
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="number-pad"
              placeholderTextColor={themeColor().muted}
            />
            <Text style={styles.label}>Fee per player ($)</Text>
            <TextInput
              style={styles.input}
              value={feeDollars}
              onChangeText={setFeeDollars}
              keyboardType="decimal-pad"
              placeholderTextColor={themeColor().muted}
            />
            <Text style={styles.hint}>
              Current kickoff: {initialStartAt ? fmtPickupDtEt(initialStartAt) : "—"} · Status: {statusLabel}
            </Text>
            <Pressable
              disabled={busy}
              onPress={() => {
                void hapticTap();
                const cap = Number(capacity);
                const fee = Math.round(Number(feeDollars) * 100);
                onSave({ start_at: startAt.trim(), capacity: cap, fee_cents: fee });
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                busy && styles.primaryBtnDisabled,
                pressed && !busy && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.primaryBtnText}>{busy ? "Saving…" : "Save changes"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function make_styles() {
  return StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: themeColor().scrim },
  sheet: {
    maxHeight: "88%",
    backgroundColor: themeColor().bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { color: themeColor().text, fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800" },
  label: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: themeColor().card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    padding: 12,
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_400Regular",
  },
  hint: { color: themeColor().muted, lineHeight: 20, marginTop: 12, marginBottom: 8, fontSize: 13, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

