import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
};

function pad(n: number) { return String(n).padStart(2, "0"); }

type EtParts = { year: number; month: number; day: number; hour12: number; ampm: "AM" | "PM"; minute: number };

function isDST(y: number, m: number, d: number) {
  const date = new Date(y, m, d);
  const march = new Date(y, 2, 1);
  const nov = new Date(y, 10, 1);
  const dstStart = new Date(y, 2, 8 + (7 - march.getDay()) % 7);
  const dstEnd = new Date(y, 10, 1 + (7 - nov.getDay()) % 7);
  return date >= dstStart && date < dstEnd;
}

function partsFromValue(value: string): EtParts {
  const trimmed = value.trim();
  if (!trimmed) {
    const d = new Date();
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour12: 6,
      ampm: "PM",
      minute: 0,
    };
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    const d = new Date();
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour12: 6,
      ampm: "PM",
      minute: 0,
    };
  }
  const etOffset = isDST(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) ? 4 : 5;
  const etDate = new Date(parsed.getTime() - etOffset * 60 * 60 * 1000);
  const h24 = etDate.getUTCHours();
  return {
    year: etDate.getUTCFullYear(),
    month: etDate.getUTCMonth() + 1,
    day: etDate.getUTCDate(),
    hour12: h24 % 12 || 12,
    ampm: h24 >= 12 ? "PM" : "AM",
    minute: etDate.getUTCMinutes(),
  };
}

export default function DateTimePicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const initial = partsFromValue(value);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [hour12, setHour12] = useState(initial.hour12);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initial.ampm);
  const [minute, setMinute] = useState(initial.minute);

  useEffect(() => {
    const p = partsFromValue(value);
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
    setHour12(p.hour12);
    setAmpm(p.ampm);
    setMinute(p.minute);
  }, [value]);

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const years = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + i);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const hours12 = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = [0, 15, 30, 45];

  function confirm() {
    let h = hour12 % 12;
    if (ampm === "PM") h += 12;
    const offset = isDST(year, month - 1, day) ? 4 : 5;
    const utcMs = Date.UTC(year, month - 1, day, h + offset, minute, 0);
    onChange(new Date(utcMs).toISOString().slice(0, 19) + "Z");
    setOpen(false);
  }

  const display = value
    ? months[month - 1] + " " + day + ", " + year + " at " + hour12 + ":" + pad(minute) + " " + ampm + " ET"
    : "Tap to set date & time";

  return (
    <>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={[styles.triggerText, !value && styles.placeholder]}>{display}</Text>
        <Text style={styles.icon}>{"📅"}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Select date & time (ET)</Text>
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.colLabel}>Month</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {months.map((m, i) => (
                    <Pressable key={m} onPress={() => setMonth(i + 1)} style={[styles.item, month === i + 1 ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, month === i + 1 ? styles.itemTextActive : null]}>{m}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.col}>
                <Text style={styles.colLabel}>Day</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {days.map((d) => (
                    <Pressable key={d} onPress={() => setDay(d)} style={[styles.item, day === d ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, day === d ? styles.itemTextActive : null]}>{String(d)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.col}>
                <Text style={styles.colLabel}>Year</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {years.map((y) => (
                    <Pressable key={y} onPress={() => setYear(y)} style={[styles.item, year === y ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, year === y ? styles.itemTextActive : null]}>{String(y)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.col}>
                <Text style={styles.colLabel}>Hour</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {hours12.map((h) => (
                    <Pressable key={h} onPress={() => setHour12(h)} style={[styles.item, hour12 === h ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, hour12 === h ? styles.itemTextActive : null]}>{String(h)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.col}>
                <Text style={styles.colLabel}>Min</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {minutes.map((m) => (
                    <Pressable key={m} onPress={() => setMinute(m)} style={[styles.item, minute === m ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, minute === m ? styles.itemTextActive : null]}>{pad(m)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.col}>
                <Text style={styles.colLabel}>AM/PM</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {(["AM", "PM"] as const).map((a) => (
                    <Pressable key={a} onPress={() => setAmpm(a)} style={[styles.item, ampm === a ? styles.itemActive : null]}>
                      <Text style={[styles.itemText, ampm === a ? styles.itemTextActive : null]}>{a}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </View>
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
  trigger: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1a1a1a", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 12, marginBottom: 12 },
  triggerText: { color: "#fff", fontSize: 14 },
  placeholder: { color: "rgba(255,255,255,0.35)" },
  icon: { fontSize: 16 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 16, textAlign: "center" },
  row: { flexDirection: "row", gap: 6, height: 200 },
  col: { flex: 1 },
  colLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, textAlign: "center", marginBottom: 4 },
  scroll: { flex: 1 },
  item: { paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  itemActive: { backgroundColor: "rgba(163,230,53,0.15)" },
  itemText: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  itemTextActive: { color: "#a3e635", fontWeight: "700" },
  confirmBtn: { backgroundColor: "#a3e635", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 16 },
  confirmText: { color: "#111", fontWeight: "800", fontSize: 15 },
  cancelBtn: { alignItems: "center", marginTop: 10 },
  cancelText: { color: "rgba(255,255,255,0.45)", fontSize: 14 },
});
