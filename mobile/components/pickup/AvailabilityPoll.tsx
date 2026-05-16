import { useAuth } from "@/context/AuthContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { hapticKick, hapticTap } from "@/lib/haptics";
import { fmtPickupDtEt, fmtPickupTimeEt } from "@/lib/pickupPublic";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

/** Fallback when the run has no `pickup_run_time_slots` rows yet (commit creates them by label). */
const DEFAULT_TIME_SLOTS = [
  { label: "10am-12pm", display: "10am – 12pm" },
  { label: "3pm-5pm", display: "3pm – 5pm" },
  { label: "7pm-10pm", display: "7pm – 10pm" },
] as const;

export type PickupTimeSlotChip = {
  key: string;
  label: string;
  display: string;
  slotId: string | null;
};

export type PickupPlanningAvailability = {
  my_availability?: Array<{
    slot_id?: string | null;
    slot_label?: string | null;
    state?: string;
  }>;
};

type Props = {
  run: Record<string, unknown>;
  planning?: PickupPlanningAvailability | null;
  onSubmit: () => void;
  onDecline: () => void;
};

function slotDisplayFromRow(row: Record<string, unknown>): string {
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (label.length > 0) return label;
  const startAt = typeof row.start_at === "string" ? row.start_at : null;
  if (startAt) return fmtPickupDtEt(startAt);
  return "Time slot";
}

export function resolvePickupTimeSlotChips(run: Record<string, unknown>): PickupTimeSlotChip[] {
  const raw = run.pickup_run_time_slots;
  if (Array.isArray(raw) && raw.length > 0) {
    const chips: PickupTimeSlotChip[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const slotId = typeof row.id === "string" ? row.id : null;
      const label = typeof row.label === "string" && row.label.trim().length > 0 ? row.label.trim() : null;
      const startAt = typeof row.start_at === "string" ? row.start_at : null;
      const key = label ?? slotId ?? "";
      if (!key) continue;
      const display =
        label ??
        (startAt ? `${fmtPickupTimeEt(startAt)} ET` : slotDisplayFromRow(row));
      chips.push({
        key,
        label: label ?? key,
        display,
        slotId,
      });
    }
    if (chips.length > 0) return chips;
  }
  return DEFAULT_TIME_SLOTS.map((s) => ({
    key: s.label,
    label: s.label,
    display: s.display,
    slotId: null,
  }));
}

function parseSubmittedLabels(planning: PickupPlanningAvailability | null | undefined): string[] {
  const ma = planning?.my_availability;
  if (!Array.isArray(ma)) return [];
  const out: string[] = [];
  for (const entry of ma) {
    if (!entry || entry.state !== "available") continue;
    const label =
      typeof entry.slot_label === "string" && entry.slot_label.trim().length > 0
        ? entry.slot_label.trim()
        : typeof entry.slot_id === "string" && entry.slot_id.trim().length > 0
          ? entry.slot_id.trim()
          : null;
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function AvailabilityPoll({ run, planning, onSubmit, onDecline }: Props) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const runId = typeof run.id === "string" ? run.id : null;
  const { availabilityBusy, commitAvailability, commitAvailabilitySlots, pendingSlotKey } = usePickupJoin();

  const chips = useMemo(() => resolvePickupTimeSlotChips(run), [run]);
  const chipKeySet = useMemo(() => new Set(chips.map((c) => c.key)), [chips]);
  const submittedLabels = useMemo(() => {
    const fromPlanning = parseSubmittedLabels(planning);
    return fromPlanning.filter((l) => chipKeySet.has(l));
  }, [planning, chipKeySet]);

  const hasSubmitted = submittedLabels.length > 0;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (hasSubmitted && !editing) {
      setSelectedKeys([...submittedLabels]);
    }
  }, [hasSubmitted, submittedLabels, editing]);

  const showPicker = !hasSubmitted || editing;

  const onToggleChip = useCallback(
    (key: string) => {
      if (availabilityBusy) return;
      void hapticTap();
      setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    },
    [availabilityBusy],
  );

  const onPressSubmit = useCallback(async () => {
    if (!token || !runId || selectedKeys.length === 0) return;
    const labels = chips
      .filter((c) => selectedKeys.includes(c.key))
      .map((c) => c.label)
      .sort();
    void hapticKick();
    const ok = await commitAvailabilitySlots(token, runId, labels, async () => {
      onSubmit();
    });
    if (ok) {
      setEditing(false);
    }
  }, [token, runId, selectedKeys, chips, commitAvailabilitySlots, onSubmit]);

  const onPressDecline = useCallback(async () => {
    if (!token || !runId) return;
    void hapticTap();
    await commitAvailability(token, runId, "declined", null, async () => {
      setSelectedKeys([]);
      setEditing(false);
      onDecline();
    });
  }, [token, runId, commitAvailability, onDecline]);

  const onPressChange = useCallback(() => {
    setEditing(true);
    setSelectedKeys([]);
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Which times work for you?</Text>

      {hasSubmitted && !editing ? (
        <View style={styles.submittedRow}>
          <FontAwesome name="check-circle" size={18} color="#bbf7d0" />
          <Text style={styles.submittedText} numberOfLines={3}>
            You&apos;re available for:{" "}
            {chips
              .filter((c) => submittedLabels.includes(c.key))
              .map((c) => c.display)
              .join(", ")}
          </Text>
        </View>
      ) : null}

      {showPicker ? (
        <>
          <View style={styles.chipRow}>
            {chips.map((chip) => {
              const selected = selectedKeys.includes(chip.key);
              return (
                <Pressable
                  key={chip.key}
                  disabled={availabilityBusy}
                  onPress={() => onToggleChip(chip.key)}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    availabilityBusy && styles.chipDisabled,
                    pressed && !availabilityBusy && { opacity: 0.88 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${chip.display}${selected ? ", selected" : ""}`}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                    {chip.display}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            disabled={availabilityBusy || !runId || selectedKeys.length === 0}
            onPress={() => void onPressSubmit()}
            style={({ pressed }) => [
              styles.submitBtn,
              (availabilityBusy || selectedKeys.length === 0) && styles.submitBtnDisabled,
              pressed && !availabilityBusy && selectedKeys.length > 0 && { opacity: 0.9 },
            ]}
          >
            {availabilityBusy && pendingSlotKey === "multi" ? (
              <ActivityIndicator color="#111" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Submit availability</Text>
            )}
          </Pressable>

          <Pressable
            disabled={availabilityBusy || !runId}
            onPress={() => void onPressDecline()}
            style={({ pressed }) => [
              styles.declineBtn,
              availabilityBusy && styles.declineBtnDisabled,
              pressed && !availabilityBusy && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.declineBtnText}>I can&apos;t make it</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={onPressChange}
          style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Change availability"
        >
          <Text style={styles.changeBtnText}>Change</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 12 },
  heading: { color: "#fff", fontSize: 16, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipSelected: {
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "rgba(163,230,53,0.14)",
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 14 },
  chipTextSelected: { color: LIME },
  submitBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.42 },
  submitBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  declineBtn: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  declineBtnDisabled: { opacity: 0.5 },
  declineBtnText: { color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 14 },
  submittedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  submittedText: { flex: 1, color: "rgba(255,255,255,0.8)", fontSize: 14, lineHeight: 20 },
  changeBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  changeBtnText: { color: "#ecfccb", fontSize: 13, fontWeight: "800" },
});
