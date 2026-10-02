import { useAuth } from "@/context/AuthContext";
import { fmtPickupDt } from "@/lib/pickupPublic";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  useThemedStyles(publish_styles);

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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor().pitchText} />}
    >
      {!isReady || loading ? (
        <ActivityIndicator size="large" color={themeColor().text} style={styles.spinner} />
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errTitle}>Couldn&apos;t load status</Text>
          <Text style={styles.errBody}>{error}</Text>
        </View>
      ) : !hasSomething ? (
        <View style={styles.card}>
          <View style={styles.emptyHeaderRow}>
            <FontAwesome name="bell-o" size={18} color={themeColor().pitchText} />
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

function make_styles() {
  return StyleSheet.create({
  scroll: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 36 },
  spinner: { marginTop: 32 },
  card: {
    marginTop: 0,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardEyebrow: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
  },
  sectionEyebrow: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
    marginBottom: 12,
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
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  labelBadgeEveryoneText: { color: themeColor().onPitchPanel, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800",},
  labelBadgeMuted: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  labelBadgeMutedText: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().muted,
  },
  metaTime: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, flexShrink: 0 },
  metaTimeSmall: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, flexShrink: 0 },
  message: {
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  messageRun: {
    marginTop: 12,
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  noRunUpdate: {
    marginTop: 12,
    color: themeColor().muted,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  runHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: { fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold",},
  pillTextMuted: { color: themeColor().text },
  pillTextLimeSoft: { color: themeColor().pitchText },
  pillTextActive: { color: themeColor().pitchText },
  pillPlanning: {
    backgroundColor: themeColor().overlaySubtle,
    borderColor: themeColor().line,
  },
  pillLikely: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  pillActive: {
    backgroundColor: themeColor().pitchPanel,
    borderColor: themeColor().pitch,
  },
  runTitle: {
    marginTop: 12,
    fontSize: 20, ...headline,
    color: themeColor().text,
  },
  feedList: { gap: 8 },
  feedItem: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  feedTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  feedMessage: {
    color: themeColor().text,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  emptyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, ...headline, color: themeColor().text },
  emptyBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  errTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().coralText },
  errBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}


