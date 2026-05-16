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

export function AvailabilityPoll({ run, planning, onSubmit }: Props) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const runId = typeof run.id === "string" ? run.id : null;
  const { availabilityBusy, commitAvailabilitySlots, pendingSlotKey } = usePickupJoin();

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

  const onPressChange = useCallback(() => {
    setEditing(true);
    setSelectedKeys([]);
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Optional — let us know which times work</Text>

      {hasSubmitted && !editing ? (
        <View style={styles.submittedRow}>
          <FontAwesome name="check-circle" size={14} color="rgba(163,230,53,0.7)" />
          <Text style={styles.submittedText} numberOfLines={3}>
            Available:{" "}
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

          <View style={styles.actionsRow}>
            <Pressable
              disabled={availabilityBusy || !runId || selectedKeys.length === 0}
              onPress={() => void onPressSubmit()}
              style={({ pressed }) => [
                styles.saveLink,
                (availabilityBusy || selectedKeys.length === 0) && styles.saveLinkDisabled,
                pressed && !availabilityBusy && selectedKeys.length > 0 && { opacity: 0.75 },
              ]}
            >
              {availabilityBusy && pendingSlotKey === "multi" ? (
                <ActivityIndicator color="rgba(255,255,255,0.45)" size="small" />
              ) : (
                <Text style={styles.saveLinkText}>Save availability</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : (
        <Pressable
          onPress={onPressChange}
          style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.75 }]}
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
  wrap: { gap: 10 },
  heading: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: "500", lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  chipSelected: {
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: "rgba(255,255,255,0.55)", fontWeight: "600", fontSize: 12 },
  chipTextSelected: { color: "rgba(163,230,53,0.9)" },
  actionsRow: { alignItems: "center", gap: 8, marginTop: 2 },
  saveLink: { paddingVertical: 4 },
  saveLinkDisabled: { opacity: 0.35 },
  saveLinkText: { color: "rgba(255,255,255,0.45)", fontWeight: "600", fontSize: 13 },
  submittedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
  },
  submittedText: { flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 18 },
  changeBtn: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  changeBtnText: { color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: "600" },
});
