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

/** Wheel values (1–12 + AM/PM) → 24h Eastern wall clock hour. */
function toHour24(hour12: number, ampm: "AM" | "PM"): number {
  if (ampm === "PM" && hour12 !== 12) return hour12 + 12;
  if (ampm === "AM" && hour12 === 12) return 0;
  return hour12;
}

/** Resolve UTC millis for Eastern *wall* datetime (America/New_York) via Intl, not device-local DST guesses. */
function etWallClockToUtcMilliseconds(y: number, mo: number, d: number, hour24: number, minute: number): number {
  const coarse = Date.UTC(y, mo - 1, d, hour24, minute, 0);
  const lo = coarse - 24 * 60 * 60 * 1000;
  const hi = coarse + 24 * 60 * 60 * 1000;
  const step = 60 * 1000;
  for (let t = lo; t <= hi; t += step) {
    const p = getEtCalendarParts(new Date(t));
    if (
      p.year === y &&
      p.month === mo &&
      p.day === d &&
      p.hour24 === hour24 &&
      p.minute === minute
    ) {
      return t;
    }
  }
  /* Should be unreachable with valid Intl; approximate fallback (~EST). */
  return Date.UTC(y, mo - 1, d, hour24 + 5, minute, 0);
}

function selectionToUtcMs(y: number, mo: number, d: number, hour12: number, ampm: "AM" | "PM", minute: number): number {
  const hour24 = toHour24(hour12, ampm);
  return etWallClockToUtcMilliseconds(y, mo, d, hour24, minute);
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
  let hour24 = Number(m.hour);
  let minuteNum = Number(m.minute);

  /** Hermes / some Intl builds omit numeric hour/minute parts; parse formatted string fallback. */
  if (!Number.isFinite(hour24) || !Number.isFinite(minuteNum)) {
    const s = f.format(date);
    const mm = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})/.exec(s);
    if (mm) {
      hour24 = Number(mm[4]);
      minuteNum = Number(mm[5]);
    }
  }

  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour24,
    minute: minuteNum,
  };
}

function addOneCalendarDay(y: number, mo: number, d: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d + 1));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function etCalToEtParts(et: EtCal): EtParts {
  const h24 = et.hour24;
  return {
    year: et.year,
    month: et.month,
    day: et.day,
    hour12: h24 % 12 || 12,
    ampm: (h24 >= 12 ? "PM" : "AM") as "AM" | "PM",
    minute: et.minute,
  };
}

/** `YYYY-MM-DDTHH:mm` with no timezone suffix — Eastern wall clock, not device local. */
function parseEasternWallDatetimeLocal(raw: string): EtCal | null {
  const s = raw.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour24 = Number(m[4]);
  const minute = Number(m[5]);
  if (![year, month, day, hour24, minute].every(Number.isFinite)) return null;
  return { year, month, day, hour24, minute };
}

function isUtcMidnightIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d{3})?Z$/i.test(s.trim());
}

function utcCalendarDateFromIso(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T00:00:00/i.exec(s.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function weekdayUtc(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Eastern wall-clock picker parts from a stored value (UTC ISO, `YYYY-MM-DDTHH:mm` ET local, etc.).
 */
export function partsFromEasternInstant(value: string): EtParts {
  const trimmed = value.trim();
  if (!trimmed) return defaultTomorrowEightPmEtParts();

  const wallLocal = parseEasternWallDatetimeLocal(trimmed);
  if (wallLocal) return etCalToEtParts(wallLocal);

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return defaultTomorrowEightPmEtParts();

  if (isUtcMidnightIso(trimmed)) {
    const utcDate = utcCalendarDateFromIso(trimmed);
    if (utcDate) {
      const et = getEtCalendarParts(parsed);
      // Date-only planning anchor: `2026-05-31T00:00:00Z` labels Sunday May 31, but ET shows Saturday 8 PM.
      const etSaturday = weekdayUtc(et.year, et.month, et.day) === 6;
      const utcSunday = weekdayUtc(utcDate.year, utcDate.month, utcDate.day) === 0;
      const etEightPm = et.hour24 === 20 && et.minute === 0;
      if (etEightPm && etSaturday && utcSunday) {
        return { year: utcDate.year, month: utcDate.month, day: utcDate.day, hour12: 8, ampm: "PM", minute: 0 };
      }
    }
  }

  return etCalToEtParts(getEtCalendarParts(parsed));
}

/** Resolve any picker value to a UTC ISO instant (for comparisons and slot labels). */
export function easternInstantToUtcIso(value: string): string {
  const parts = partsFromEasternInstant(value);
  const ms = selectionToUtcMs(parts.year, parts.month, parts.day, parts.hour12, parts.ampm, parts.minute);
  return new Date(ms).toISOString();
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
export function isScheduleWallMidnightEt(value: string): boolean {
  const s = value.trim();
  if (!s) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const wall = parseEasternWallDatetimeLocal(s);
  if (wall) return wall.hour24 === 0 && wall.minute === 0;
  const parts = partsFromEasternInstant(s);
  const h24 = toHour24(parts.hour12, parts.ampm);
  return h24 === 0 && parts.minute === 0;
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
  const parsedParts = partsFromEasternInstant(trimmed);
  if (enforceFuture) {
    return clampPartsToFuture(parsedParts);
  }
  return parsedParts;
}

/**
 * Format a stored picker value as `YYYY-MM-DDTHH:mm` Eastern wall clock for admin APIs
 * that parse datetimes as America/New_York (not as UTC or device local).
 */
export function utcIsoToEasternDatetimeLocal(value: string): string {
  const parts = partsFromEasternInstant(value);
  if (!value.trim()) return "";
  const hour24 = toHour24(parts.hour12, parts.ampm);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(hour24)}:${pad(parts.minute)}`;
}

/** Display selected instant in America/New_York, e.g. "Thu May 22 · 8:00 PM ET". */
export function formatDateTimePickerEtLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const d = new Date(easternInstantToUtcIso(trimmed));
  if (!Number.isFinite(d.getTime())) return "";
  const df = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const formatted = df.formatToParts(d);
  const dateParts: Record<string, string> = {};
  for (const fp of formatted) {
    if (fp.type !== "literal") dateParts[fp.type] = fp.value;
  }
  const weekday = dateParts.weekday ?? "";
  const month = dateParts.month ?? "";
  const dayNum = dateParts.day ?? "";

  /** Single pattern keeps hour/minute on Hermes/Android (formatToParts can omit hour with hour12:true). */
  const tf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const timeEt = tf.format(d);

  return `${weekday} ${month} ${dayNum} · ${timeEt} ET`;
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
  const minutes = [0, 15, 30, 45];
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
    const hour24 = toHour24(hour12, ampm);
    onChange(`${year}-${pad(month)}-${pad(day)}T${pad(hour24)}:${pad(minute)}`);
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

            <View style={styles.rowDivider} />

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
  sheet: { backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 60 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  rowDivider: { height: 1, backgroundColor: "rgba(163,230,53,0.15)", marginVertical: 12 },
  pickerRow: { flexDirection: "row", gap: 8, height: 220 },
  colWide: { flex: 1.35 },
  colMedium: { flex: 1 },
  colNarrow: { flex: 0.85 },
  colLabel: { color: "rgba(255,255,255,0.3)", fontSize: 9, textAlign: "center", marginBottom: 4 },
  scroll: { flex: 1 },
  preview: {
    color: "#a3e635",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 16,
    marginBottom: 8,
  },
  item: { paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  itemActive: { backgroundColor: "rgba(163,230,53,0.2)", borderRadius: 8 },
  itemText: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  itemTextActive: { color: "#a3e635", fontWeight: "700", fontSize: 15 },
  confirmBtn: { backgroundColor: "#a3e635", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 16 },
  confirmText: { color: "#111", fontWeight: "800", fontSize: 15 },
  cancelBtn: { alignItems: "center", marginTop: 10 },
  cancelText: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
});
