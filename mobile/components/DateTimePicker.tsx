import React, { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  /** Draft defaults to tomorrow 8:00 PM ET; blocks confirming past times. */
  enforceFuture?: boolean;
  /** Larger trigger styling (e.g. create-run form). */
  prominent?: boolean;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type EtParts = { year: number; month: number; day: number; hour12: number; ampm: "AM" | "PM"; minute: number };

function isDST(y: number, m: number, d: number) {
  const date = new Date(y, m, d);
  const march = new Date(y, 2, 1);
  const nov = new Date(y, 10, 1);
  const dstStart = new Date(y, 2, 8 + (7 - march.getDay()) % 7);
  const dstEnd = new Date(y, 10, 1 + (7 - nov.getDay()) % 7);
  return date >= dstStart && date < dstEnd;
}

function selectionToUtcMs(y: number, mo: number, d: number, hour12: number, ampm: "AM" | "PM", minute: number): number {
  let h = hour12 % 12;
  if (ampm === "PM") h += 12;
  const offset = isDST(y, mo - 1, d) ? 4 : 5;
  return Date.UTC(y, mo - 1, d, h + offset, minute, 0);
}

function daysInMonth(y: number, mo: number): number {
  return new Date(y, mo, 0).getDate();
}

type EtCal = { year: number; month: number; day: number; hour24: number; minute: number };

function getEtCalendarParts(date: Date): EtCal {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = f.formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour24: Number(m.hour),
    minute: Number(m.minute),
  };
}

function addOneCalendarDay(y: number, mo: number, d: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d + 1));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** First-open default: next calendar day in Eastern at 8:00 PM. */
function defaultTomorrowEightPmEtParts(): EtParts {
  const et = getEtCalendarParts(new Date());
  const tomorrow = addOneCalendarDay(et.year, et.month, et.day);
  return {
    year: tomorrow.year,
    month: tomorrow.month,
    day: tomorrow.day,
    hour12: 8,
    ampm: "PM",
    minute: 0,
  };
}

function clampPartsToFuture(parts: EtParts): EtParts {
  let p = parts;
  for (let i = 0; i < 400; i++) {
    const ms = selectionToUtcMs(p.year, p.month, p.day, p.hour12, p.ampm, p.minute);
    if (ms > Date.now()) return p;
    const nd = addOneCalendarDay(p.year, p.month, p.day);
    p = { ...p, year: nd.year, month: nd.month, day: nd.day };
  }
  return defaultTomorrowEightPmEtParts();
}

/** Date-only, unparsable, or 12:00 AM Eastern — unsafe for run/tournament schedules. */
export function isScheduleWallMidnightEt(iso: string): boolean {
  const s = iso.trim();
  if (!s) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return true;
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = f.formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  const h = Number(m.hour ?? -1);
  const min = Number(m.minute ?? -1);
  return h === 0 && min === 0;
}

function partsFromValue(value: string, enforceFuture?: boolean): EtParts {
  const trimmed = value.trim();
  if (!trimmed) {
    const draft = defaultTomorrowEightPmEtParts();
    if (enforceFuture) {
      return clampPartsToFuture(draft);
    }
    return draft;
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    const draft = defaultTomorrowEightPmEtParts();
    if (enforceFuture) {
      return clampPartsToFuture(draft);
    }
    return draft;
  }
  const etOffset = isDST(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) ? 4 : 5;
  const etDate = new Date(parsed.getTime() - etOffset * 60 * 60 * 1000);
  const h24 = etDate.getUTCHours();
  const parsedParts = {
    year: etDate.getUTCFullYear(),
    month: etDate.getUTCMonth() + 1,
    day: etDate.getUTCDate(),
    hour12: h24 % 12 || 12,
    ampm: (h24 >= 12 ? "PM" : "AM") as "AM" | "PM",
    minute: etDate.getUTCMinutes(),
  };
  if (enforceFuture) {
    return clampPartsToFuture(parsedParts);
  }
  return parsedParts;
}

/** Display selected instant in America/New_York, e.g. "Thu May 22 · 8:00 PM ET". */
export function formatDateTimePickerEtLabel(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return "";
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return "";
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const formatted = f.formatToParts(d);
  const m: Record<string, string> = {};
  for (const fp of formatted) {
    if (fp.type !== "literal") m[fp.type] = fp.value;
  }
  const dayPeriod = (m.dayPeriod || "").toUpperCase();
  const hour = m.hour ?? "";
  const minute = m.minute ?? "";
  const weekday = m.weekday ?? "";
  const month = m.month ?? "";
  const dayNum = m.day ?? "";
  return `${weekday} ${month} ${dayNum} · ${hour}:${minute} ${dayPeriod} ET`;
}

export default function DateTimePicker({ value, onChange, label, enforceFuture, prominent }: Props) {
  const [open, setOpen] = useState(false);
  const initial = partsFromValue(value, enforceFuture);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [hour12, setHour12] = useState(initial.hour12);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initial.ampm);
  const [minute, setMinute] = useState(initial.minute);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dim = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1), [dim]);
  const hours12 = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const years = useMemo(() => {
    const y = getEtCalendarParts(new Date()).year;
    return Array.from({ length: 4 }, (_, i) => y + i);
  }, [open]);

  const previewEtLabel = useMemo(() => {
    const utcMs = selectionToUtcMs(year, month, day, hour12, ampm, minute);
    return formatDateTimePickerEtLabel(new Date(utcMs).toISOString());
  }, [year, month, day, hour12, ampm, minute]);

  useEffect(() => {
    const p = partsFromValue(value, enforceFuture);
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
    setHour12(p.hour12);
    setAmpm(p.ampm);
    setMinute(p.minute);
  }, [value, enforceFuture, open]);

  useEffect(() => {
    const dim = daysInMonth(year, month);
    if (day > dim) setDay(dim);
  }, [year, month, day]);

  useEffect(() => {
    if (!open || !enforceFuture) return;
    const ms = selectionToUtcMs(year, month, day, hour12, ampm, minute);
    if (ms > Date.now()) return;
    const p = clampPartsToFuture({ year, month, day, hour12, ampm, minute });
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
    setHour12(p.hour12);
    setAmpm(p.ampm);
    setMinute(p.minute);
  }, [open, enforceFuture, year, month, day, hour12, ampm, minute]);

  function confirm() {
    const utcMs = selectionToUtcMs(year, month, day, hour12, ampm, minute);
    if (enforceFuture && utcMs <= Date.now()) {
      Alert.alert("Invalid date", "Start time must be in the future.");
      return;
    }
    onChange(new Date(utcMs).toISOString());
    setOpen(false);
  }

  const display = value.trim()
    ? formatDateTimePickerEtLabel(value)
    : "Tap to set date & time";

  return (
    <>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, prominent && styles.triggerProminent]}
      >
        <Text style={[styles.triggerText, prominent && styles.triggerTextProminent, !value.trim() && styles.placeholder]}>
          {display}
        </Text>
        <Text style={styles.icon}>{"📅"}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Select date & time (ET)</Text>
            <Text style={styles.sectionSubtitle}>Date</Text>
            <View style={styles.pickerRow}>
              <View style={styles.colWide}>
                <Text style={styles.colLabel}>Month</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {months.map((m, i) => (
                    <Pressable
                      key={m}
                      onPress={() => setMonth(i + 1)}
                      style={[styles.item, month === i + 1 ? styles.itemActive : null]}
                    >
                      <Text style={[styles.itemText, month === i + 1 ? styles.itemTextActive : null]}>{m}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.colNarrow}>
                <Text style={styles.colLabel}>Day</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {days.map((d) => (
                    <Pressable key={d} onPress={() => setDay(d)} style={[styles.item, day === d ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, day === d ? styles.itemTextActive : null]}>{String(d)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.colMedium}>
                <Text style={styles.colLabel}>Year</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {years.map((y) => (
                    <Pressable key={y} onPress={() => setYear(y)} style={[styles.item, year === y ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, year === y ? styles.itemTextActive : null]}>{String(y)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </View>

            <Text style={styles.sectionSubtitle}>Time</Text>
            <View style={styles.pickerRow}>
              <View style={styles.colMedium}>
                <Text style={styles.colLabel}>Hour</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {hours12.map((h) => (
                    <Pressable key={h} onPress={() => setHour12(h)} style={[styles.item, hour12 === h ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, hour12 === h ? styles.itemTextActive : null]}>{String(h)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.colMedium}>
                <Text style={styles.colLabel}>Minute</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {minutes.map((m) => (
                    <Pressable key={m} onPress={() => setMinute(m)} style={[styles.item, minute === m ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, minute === m ? styles.itemTextActive : null]}>{pad(m)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.colNarrow}>
                <Text style={styles.colLabel}>AM / PM</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {(["AM", "PM"] as const).map((a) => (
                    <Pressable key={a} onPress={() => setAmpm(a)} style={[styles.item, ampm === a ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, ampm === a ? styles.itemTextActive : null]}>{a}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </View>

            <Text style={styles.previewLabel}>Confirmed together</Text>
            <Text style={styles.preview}>{previewEtLabel}</Text>

            <Pressable onPress={confirm} style={styles.confirmBtn}>
              <Text style={styles.confirmText}>Confirm</Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
    marginBottom: 12,
  },
  triggerProminent: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(163,230,53,0.5)",
    marginBottom: 10,
    backgroundColor: "#141414",
  },
  triggerText: { color: "#fff", fontSize: 14, flex: 1, paddingRight: 8 },
  triggerTextProminent: { fontSize: 16, fontWeight: "700" },
  placeholder: { color: "rgba(255,255,255,0.35)", fontWeight: "600" },
  icon: { fontSize: 16 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  sectionSubtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 4,
  },
  pickerRow: { flexDirection: "row", gap: 8, height: 200 },
  colWide: { flex: 1.35 },
  colMedium: { flex: 1 },
  colNarrow: { flex: 0.85 },
  colLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, textAlign: "center", marginBottom: 4 },
  scroll: { flex: 1 },
  previewLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },
  preview: {
    color: "#a3e635",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 4,
  },
  item: { paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  itemActive: { backgroundColor: "rgba(163,230,53,0.15)" },
  itemText: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  itemTextActive: { color: "#a3e635", fontWeight: "700" },
  confirmBtn: { backgroundColor: "#a3e635", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 16 },
  confirmText: { color: "#111", fontWeight: "800", fontSize: 15 },
  cancelBtn: { alignItems: "center", marginTop: 10 },
  cancelText: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
});
