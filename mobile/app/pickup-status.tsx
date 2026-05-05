import { useAuth } from "@/context/AuthContext";
import { fmtPickupDt } from "@/lib/pickupPublic";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type PickupRunRow = {
  id: string;
  title: string | null;
  status: string;
  start_at: string | null;
  created_at: string;
};

type RunUpdateRow = {
  id: string;
  run_id: string | null;
  message: string;
  created_at: string;
};

function statusPillPresentation(status: string): { label: string; pill: object; text: object } {
  if (status === "active")
    return { label: "Active", pill: styles.pillActive, text: styles.pillTextActive };
  if (status === "likely_on")
    return { label: "Likely on", pill: styles.pillLikely, text: styles.pillTextLimeSoft };
  if (status === "planning")
    return { label: "Planning", pill: styles.pillPlanning, text: styles.pillTextMuted };
  const label = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  return { label, pill: styles.pillPlanning, text: styles.pillTextMuted };
}

export default function PickupStatusScreen() {
  const { supabase, isReady } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalUpdate, setGlobalUpdate] = useState<RunUpdateRow | null>(null);
  const [run, setRun] = useState<PickupRunRow | null>(null);
  const [runUpdate, setRunUpdate] = useState<RunUpdateRow | null>(null);
  const [feed, setFeed] = useState<RunUpdateRow[]>([]);

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase not configured.");
      setGlobalUpdate(null);
      setRun(null);
      setRunUpdate(null);
      setFeed([]);
      return;
    }
    setError(null);

    const [globalRes, runRes, feedRes] = await Promise.all([
      supabase
        .from("pickup_run_updates")
        .select("id, run_id, message, created_at")
        .is("run_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("pickup_runs")
        .select("id, title, status, start_at, created_at")
        .eq("is_current", true)
        .eq("run_type", "public")
        .maybeSingle(),
      supabase
        .from("pickup_run_updates")
        .select("id, run_id, message, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    let errMsg: string | null =
      globalRes.error?.message ?? runRes.error?.message ?? feedRes.error?.message ?? null;

    const runRow =
      runRes.data && typeof runRes.data === "object" && typeof (runRes.data as PickupRunRow).id === "string"
        ? (runRes.data as PickupRunRow)
        : null;

    let latestRunUpdate: RunUpdateRow | null = null;
    if (runRow?.id && !runRes.error) {
      const ru = await supabase
        .from("pickup_run_updates")
        .select("id, run_id, message, created_at")
        .eq("run_id", runRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ru.error) errMsg = ru.error.message;
      latestRunUpdate = (ru.data as RunUpdateRow | null) ?? null;
    }

    if (errMsg) {
      setError(errMsg);
    }

    const g = globalRes.error ? null : ((globalRes.data as RunUpdateRow | null) ?? null);
    setGlobalUpdate(g);
    setRun(runRes.error ? null : runRow);
    setRunUpdate(latestRunUpdate);
    setFeed(feedRes.error ? [] : ((feedRes.data as RunUpdateRow[] | null) ?? []));
  }, [supabase]);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const hasSomething = useMemo(
    () => !!globalUpdate || !!run || feed.length > 0,
    [globalUpdate, run, feed],
  );

  const runPill = run ? statusPillPresentation(run.status) : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
    >
      {!isReady || loading ? (
        <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errTitle}>Couldn&apos;t load status</Text>
          <Text style={styles.errBody}>{error}</Text>
        </View>
      ) : !hasSomething ? (
        <View style={styles.card}>
          <View style={styles.emptyHeaderRow}>
            <FontAwesome name="bell-o" size={18} color={LIME} />
            <Text style={styles.cardEyebrow}>Pickup status</Text>
          </View>
          <Text style={styles.emptyTitle}>No updates right now</Text>
          <Text style={styles.emptyBody}>When organizers post announcements, they will show up here.</Text>
        </View>
      ) : (
        <>
          {globalUpdate ? (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <View style={styles.labelBadgeEveryone}>
                  <Text style={styles.labelBadgeEveryoneText}>Everyone</Text>
                </View>
                <Text style={styles.metaTime}>{fmtPickupDt(globalUpdate.created_at)}</Text>
              </View>
              <Text style={styles.message}>{globalUpdate.message}</Text>
            </View>
          ) : null}

          {run ? (
            <View style={styles.card}>
              <View style={styles.runHeaderRow}>
                <View style={[styles.statusPill, runPill?.pill]}>
                  <Text style={[styles.statusPillText, runPill?.text]}>{runPill?.label}</Text>
                </View>
                <Text style={styles.metaTime} numberOfLines={1}>
                  {fmtPickupDt(run.start_at)}
                </Text>
              </View>
              <Text style={styles.runTitle}>{typeof run.title === "string" && run.title.trim() ? run.title : "Pickup run"}</Text>
              {runUpdate ? (
                <Text style={styles.messageRun}>{runUpdate.message}</Text>
              ) : (
                <Text style={styles.noRunUpdate}>No run-specific update yet.</Text>
              )}
            </View>
          ) : null}

          {feed.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionEyebrow}>Recent</Text>
              <View style={styles.feedList}>
                {feed.map((u) => (
                  <View key={String(u.id)} style={styles.feedItem}>
                    <View style={styles.feedTop}>
                      <View style={styles.labelBadgeMuted}>
                        <Text style={styles.labelBadgeMutedText}>{u.run_id ? "One run" : "Everyone"}</Text>
                      </View>
                      <Text style={styles.metaTimeSmall}>{fmtPickupDt(u.created_at)}</Text>
                    </View>
                    <Text style={styles.feedMessage}>{u.message}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 36 },
  spinner: { marginTop: 32 },
  card: {
    marginTop: 0,
    marginBottom: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
  },
  sectionEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
    marginBottom: 14,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  labelBadgeEveryone: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  labelBadgeEveryoneText: { color: LIME, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  labelBadgeMuted: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  labelBadgeMutedText: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  metaTime: { fontSize: 12, color: "rgba(255,255,255,0.5)", flexShrink: 0 },
  metaTimeSmall: { fontSize: 11, color: "rgba(255,255,255,0.45)", flexShrink: 0 },
  message: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 22,
  },
  messageRun: {
    marginTop: 12,
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 22,
  },
  noRunUpdate: {
    marginTop: 12,
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    lineHeight: 20,
  },
  runHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: { fontWeight: "800", fontSize: 13, letterSpacing: 0.3 },
  pillTextMuted: { color: "rgba(255,255,255,0.82)" },
  pillTextLimeSoft: { color: "rgba(163,230,53,0.95)" },
  pillTextActive: { color: LIME },
  pillPlanning: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.14)",
  },
  pillLikely: {
    backgroundColor: "rgba(163,230,53,0.1)",
    borderColor: "rgba(163,230,53,0.35)",
  },
  pillActive: {
    backgroundColor: "rgba(163,230,53,0.18)",
    borderColor: "rgba(163,230,53,0.5)",
  },
  runTitle: {
    marginTop: 14,
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  feedList: { gap: 10 },
  feedItem: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  feedTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  feedMessage: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    lineHeight: 21,
  },
  emptyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  emptyBody: { marginTop: 8, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 21 },
  errTitle: { fontSize: 16, fontWeight: "700", color: "#fca5a5" },
  errBody: { marginTop: 8, color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 20 },
});

