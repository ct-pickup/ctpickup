import { useAuth } from "@/context/AuthContext";
import { formatTournamentStartEt } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

type Row = Record<string, unknown>;

function s(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function labelEt(raw: unknown): string {
  const x = s(raw);
  return x ? formatTournamentStartEt(x) : "—";
}

export default function EsportsDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { supabase, isReady } = useAuth();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<Row | null>(null);

  useLayoutEffect(() => {
    const title = row?.title ? s(row.title) : "Esports";
    navigation.setOptions?.({
      title,
      headerTitleAlign: "center",
    });
  }, [navigation, row]);

  useEffect(() => {
    if (!isReady || !id) {
      setLoading(false);
      return;
    }
    if (!supabase) {
      setErr("Sign in or configure Supabase in mobile/.env.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr(null);

    void (async () => {
      const { data, error } = await supabase.from("esports_tournaments").select("*").eq("id", id).maybeSingle();

      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setRow(null);
      } else if (!data) {
        setErr("This tournament isn’t available in the app (it may be completed or not published).");
        setRow(null);
      } else {
        setRow(data as Row);
        setErr(null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, supabase, id]);

  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.err}>Missing tournament id.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (err || !row) {
    return (
      <View style={styles.pad}>
        <Text style={styles.err}>{err ?? "Not found"}</Text>
      </View>
    );
  }

  const status = s(row.status).toLowerCase();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{status === "active" ? "Live" : status === "completed" ? "Completed" : "Upcoming"}</Text>
        </View>
        <View style={styles.pillMuted}>
          <FontAwesome name="gamepad" size={14} color="rgba(163,230,53,0.85)" />
          <Text style={styles.pillMutedText}> {s(row.game)}</Text>
        </View>
      </View>

      <Text style={styles.title}>{s(row.title)}</Text>
      <Text style={styles.prize}>
        <FontAwesome name="trophy" size={16} color="#a3e635" /> Prize: {s(row.prize)}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Schedule</Text>
        <Text style={styles.row}>Starts: {labelEt(row.start_date)}</Text>
        <Text style={styles.row}>Ends: {labelEt(row.end_date)}</Text>
      </View>

      {s(row.description) ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About</Text>
          <Text style={styles.body}>{s(row.description)}</Text>
        </View>
      ) : null}

      {s(row.format_summary) ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Format</Text>
          <Text style={styles.body}>{s(row.format_summary)}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Key deadlines (ET)</Text>
        <DeadlineRow label="Group stage — deadline 1" value={row.group_stage_deadline_1} />
        <DeadlineRow label="Group stage — deadline 2" value={row.group_stage_deadline_2} />
        <DeadlineRow label="Group stage — final" value={row.group_stage_final_deadline} />
        <DeadlineRow label="Knockout starts" value={row.knockout_start_at} />
        <DeadlineRow label="Quarterfinal" value={row.quarterfinal_deadline} />
        <DeadlineRow label="Semifinal" value={row.semifinal_deadline} />
        <DeadlineRow label="Final" value={row.final_deadline} />
      </View>

      <Text style={styles.footer}>
        Registration and entry fee checkout use the same account as pickup — when staff enable checkout for this event,
        you’ll complete consent and payment in a secure flow (same rules as the website).
      </Text>
    </ScrollView>
  );
}

function DeadlineRow({ label, value }: { label: string; value: unknown }) {
  const v = s(value);
  if (!v) return null;
  return (
    <Text style={styles.row}>
      <Text style={styles.deadlineLabel}>{label}: </Text>
      {labelEt(value)}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 48 },
  centered: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center", padding: 24 },
  pad: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  title: { fontSize: 26, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  prize: { marginTop: 14, fontSize: 16, color: "rgba(255,255,255,0.85)", lineHeight: 22 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  pillText: { color: "rgba(163,230,53,0.95)", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  pillMuted: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pillMutedText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "700" },
  section: { marginTop: 22 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 10,
  },
  row: { marginTop: 8, fontSize: 15, lineHeight: 22, color: "rgba(255,255,255,0.82)" },
  deadlineLabel: { color: "rgba(255,255,255,0.55)", fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 23, color: "rgba(255,255,255,0.78)" },
  err: { color: "#fca5a5", fontSize: 15, lineHeight: 22 },
  footer: {
    marginTop: 28,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,255,255,0.42)",
  },
});
