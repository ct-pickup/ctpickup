import { hapticTap } from "@/lib/haptics";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";
const TZ = "America/New_York";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function etCalendarPartsFromDate(date: Date): { year: number; month: number; day: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = f.formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return { year: Number(m.year), month: Number(m.month), day: Number(m.day) };
}

function addEtCalendarDays(y: number, mo: number, d: number, delta: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d + delta));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function weekdayUtc(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export type PollCalendarDay = {
  dateEt: string;
  weekday: string;
  month: string;
  dayNum: number;
};

export function buildUpcomingPollCalendarDays(count = 35, from = new Date()): PollCalendarDay[] {
  let { year, month, day } = etCalendarPartsFromDate(from);
  const out: PollCalendarDay[] = [];
  for (let i = 0; i < count; i++) {
    const wd = weekdayUtc(year, month, day);
    out.push({
      dateEt: `${year}-${pad(month)}-${pad(day)}`,
      weekday: WEEKDAYS[wd] ?? "?",
      month: MONTHS[month - 1] ?? "?",
      dayNum: day,
    });
    const next = addEtCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return out;
}

type Props = {
  value: string;
  onChange: (dateEt: string) => void;
};

export default function AvailabilityPollDateCalendar({ value, onChange }: Props) {
  const days = useMemo(() => buildUpcomingPollCalendarDays(35), []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Poll date (ET)</Text>
      <Text style={styles.hint}>Players vote on times for this day.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((d) => {
          const active = value === d.dateEt;
          return (
            <Pressable
              key={d.dateEt}
              onPress={() => {
                void hapticTap();
                onChange(d.dateEt);
              }}
              style={({ pressed }) => [
                styles.dayCell,
                active && styles.dayCellActive,
                pressed && { opacity: 0.88 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${d.weekday} ${d.month} ${d.dayNum}`}
            >
              <Text style={[styles.weekday, active && styles.weekdayActive]}>{d.weekday}</Text>
              <Text style={[styles.dayNum, active && styles.dayNumActive]}>{d.dayNum}</Text>
              <Text style={[styles.month, active && styles.monthActive]}>{d.month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 16, marginBottom: 10 },
  row: { gap: 8, paddingRight: 8 },
  dayCell: {
    width: 56,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
  },
  dayCellActive: {
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.15)",
  },
  weekday: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  weekdayActive: { color: LIME },
  dayNum: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 2 },
  dayNumActive: { color: LIME },
  month: { color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: "600", marginTop: 2 },
  monthActive: { color: "rgba(163,230,53,0.85)" },
});
