import { useAuth } from "@/context/AuthContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { hapticKick, hapticTap } from "@/lib/haptics";
import { fmtPickupSlotChipEt } from "@/lib/pickupPublic";
import { normalizeSlotLabelKey, slotLabelsMatch } from "@/lib/slotLabelMatch";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

/** Fallback when the run has no `pickup_run_time_slots` rows yet (commit creates them by label). */
const DEFAULT_TIME_SLOTS = [
  { label: "10am – 12pm", display: "10am – 12pm" },
  { label: "3pm – 5pm", display: "3pm – 5pm" },
  { label: "7pm – 10pm", display: "7pm – 10pm" },
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
};

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
      const display = label ?? (startAt ? fmtPickupSlotChipEt(startAt) : "Time slot");
      const key = label ?? slotId ?? (startAt ? `t:${startAt}` : "");
      if (!key) continue;
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

function resolveSubmittedChipKeys(
  planning: PickupPlanningAvailability | null | undefined,
  chips: PickupTimeSlotChip[],
): string[] {
  const ma = planning?.my_availability;
  if (!Array.isArray(ma)) return [];
  const out: string[] = [];
  for (const entry of ma) {
    if (!entry || entry.state !== "available") continue;
    const slotId =
      typeof entry.slot_id === "string" && entry.slot_id.trim().length > 0 ? entry.slot_id.trim() : null;
    const slotLabel =
      typeof entry.slot_label === "string" && entry.slot_label.trim().length > 0
        ? normalizeSlotLabelKey(entry.slot_label)
        : null;

    let matched: string | null = null;
    for (const chip of chips) {
      if (slotId && chip.slotId && chip.slotId === slotId) {
        matched = chip.key;
        break;
      }
      if (slotLabel && slotLabelsMatch(slotLabel, chip.label)) {
        matched = chip.key;
        break;
      }
      if (slotId && chip.key === slotId) {
        matched = chip.key;
        break;
      }
    }
    if (!matched) {
      matched = slotId ?? slotLabel;
    }
    if (matched && !out.includes(matched)) out.push(matched);
  }
  return out;
}

export function AvailabilityPoll({ run, planning, onSubmit }: Props) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const runId = typeof run.id === "string" ? run.id : null;
  const { availabilityBusy, commitAvailabilitySlots, pendingSlotKey } = usePickupJoin();

  const chips = useMemo(() => resolvePickupTimeSlotChips(run), [run]);
  const chipKeySet = useMemo(() => new Set(chips.map((c) => c.key)), [chips]);
  const submittedKeys = useMemo(
    () => resolveSubmittedChipKeys(planning, chips).filter((k) => chipKeySet.has(k)),
    [planning, chips, chipKeySet],
  );

  const submittedSummary = useMemo(() => {
    if (submittedKeys.length === 0) return "";
    return chips
      .filter((c) => submittedKeys.includes(c.key))
      .map((c) => c.display)
      .join(", ");
  }, [submittedKeys, chips]);

  const hasSubmitted = submittedKeys.length > 0;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (hasSubmitted && !editing) {
      setSelectedKeys([...submittedKeys]);
    }
  }, [hasSubmitted, submittedKeys, editing]);

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
    const selections = chips
      .filter((c) => selectedKeys.includes(c.key))
      .map((c) => ({ slotId: c.slotId, label: c.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    void hapticKick();
    const ok = await commitAvailabilitySlots(token, runId, selections, async () => {
      onSubmit();
    });
    if (ok) {
      setEditing(false);
    }
  }, [token, runId, selectedKeys, chips, commitAvailabilitySlots, onSubmit]);

  const onPressChange = useCallback(() => {
    setEditing(true);
    setSelectedKeys([]);
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Which times work for you?</Text>

      {hasSubmitted && !editing ? (
        <View style={styles.submittedBlock}>
          <View style={styles.submittedRow}>
            <FontAwesome name="check-circle" size={16} color={LIME} />
            <Text style={styles.submittedText}>Submitted</Text>
          </View>
          {submittedSummary ? (
            <Text style={styles.submittedSummary} numberOfLines={3}>
              {submittedSummary}
            </Text>
          ) : null}
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
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={2}>
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
              <Text style={styles.submitBtnText}>Submit Availability</Text>
            )}
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={onPressChange}
          style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel="Change availability"
        >
          <Text style={styles.changeBtnText}>Change selection</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  heading: { color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: "600", lineHeight: 20 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: LIME,
    backgroundColor: "transparent",
    maxWidth: "100%",
  },
  chipSelected: {
    borderColor: LIME,
    backgroundColor: LIME,
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: LIME, fontWeight: "600", fontSize: 13, lineHeight: 18 },
  chipTextSelected: { color: "#111", fontWeight: "700" },
  submitBtn: {
    marginTop: 4,
    backgroundColor: LIME,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: "#111", fontWeight: "800", fontSize: 14 },
  submittedBlock: { gap: 4, paddingVertical: 2 },
  submittedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submittedText: { color: LIME, fontSize: 14, fontWeight: "700" },
  submittedSummary: { color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 18 },
  changeBtn: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  changeBtnText: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "600" },
});
