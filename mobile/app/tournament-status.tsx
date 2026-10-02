import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { FieldTournamentPayload, parseFieldPayload } from "@/hooks/useFieldTournament";
import { formatTournamentStartDisplay } from "@/lib/formatTournament";
import { fetchTournamentPublic } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

function headlineFor(data: FieldTournamentPayload): string {
  if (!data.tournament) return "No live tournament";
  if (data.full) return "Tournament full";
  if (data.official) return "Tournament confirmed";
  return "Organizing";
}

export default function TournamentStatusScreen() {
  useThemedStyles(publish_styles);

  const { session } = useAuth();
  const { region, ready: regionReady } = useSelectedRegion();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<FieldTournamentPayload | null>(null);

  const load = useCallback(async () => {
    if (!siteOrigin()) {
      setError("Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      setPayload(null);
      return;
    }
    if (!regionReady) return;
    setError(null);
    const r = await fetchTournamentPublic({ region, accessToken: session?.access_token ?? null });
    if (!r.ok) {
      setError("Could not load tournament status.");
      setPayload(null);
    } else {
      const parsed = parseFieldPayload(r.json);
      if (!parsed) {
        setError("Invalid response from server.");
        setPayload(null);
      } else {
        setPayload(parsed);
      }
    }
  }, [region, regionReady, session?.access_token]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!regionReady) {
        setLoading(false);
        return;
      }
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
  }, [regionReady, load]);

  const onRefresh = useCallback(async () => {
    if (!regionReady) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load, regionReady]);

  const hasTournament = !!(payload && payload.tournament);
  const headline = payload ? headlineFor(payload) : "No live tournament";
  const announcement = hasTournament ? (payload!.tournament!.announcement?.trim() || null) : null;
  const t = payload?.tournament ?? null;
  const threshold = t?.officialThreshold ?? 0;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor().pitchText} />}
    >
      {!regionReady || loading ? (
        <ActivityIndicator size="large" color={themeColor().text} style={styles.spinner} />
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errTitle}>Couldn&apos;t load status</Text>
          <Text style={styles.errBody}>{error}</Text>
        </View>
      ) : !hasTournament ? (
        <>
          <Text style={styles.headline}>{headline}</Text>
          <View style={styles.card}>
            <View style={styles.emptyHeaderRow}>
              <FontAwesome name="trophy" size={18} color={themeColor().pitchText} />
              <Text style={[styles.cardEyebrow, styles.cardEyebrowNoMb]}>Tournament status</Text>
            </View>
            <Text style={styles.emptyTitle}>No updates right now</Text>
            <Text style={styles.emptyBody}>
              When staff publish an in-person bracket for your hub, live counts and announcements will show here.
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.headline}>{headline}</Text>

          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>Status</Text>
            <Text style={styles.tournamentTitle}>{t!.title}</Text>
            {t!.start_at ? (
              <Text style={styles.startAt}>{formatTournamentStartDisplay(t!.start_at)}</Text>
            ) : null}
            <View style={styles.statsBlock}>
              <Text style={styles.statLine}>
                <Text style={styles.statLabel}>Confirmed teams </Text>
                <Text style={styles.statEmph}>
                  {payload!.confirmedTeams}
                  {t!.maxTeams ? ` / ${t!.maxTeams}` : ""}
                </Text>
              </Text>
              <Text style={styles.statLine}>
                <Text style={styles.statLabel}>Teams claimed </Text>
                <Text style={styles.statEmph}>{payload!.claimedTeams}</Text>
              </Text>
              <Text style={styles.thresholdLine}>
                Goes official at {threshold || "—"} confirmed team{threshold === 1 ? "" : "s"}
              </Text>
            </View>
          </View>

          {announcement ? (
            <View style={styles.announceCard}>
              <View style={styles.announceTop}>
                <FontAwesome name="bullhorn" size={18} color={themeColor().pitchText} />
                <Text style={styles.announceEyebrow}>Announcement</Text>
              </View>
              <Text style={styles.announceBody}>{announcement}</Text>
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
  headline: {
    fontSize: 32, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "800",
    color: themeColor().text,
    lineHeight: 34,
    marginBottom: 16,
  },
  card: {
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
    marginBottom: 8,
  },
  cardEyebrowNoMb: { marginBottom: 0 },
  tournamentTitle: {
    fontSize: 20, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "700",
    color: themeColor().text,
    lineHeight: 26,
    marginBottom: 8,
  },
  startAt: {
    fontSize: 16, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: themeColor().text,
    lineHeight: 22,
    marginBottom: 12,
  },
  statsBlock: { gap: 8 },
  statLine: { fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 22 },
  statLabel: { color: themeColor().muted },
  statEmph: { color: themeColor().text, fontWeight: "700" },
  thresholdLine: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColor().line,
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
    color: themeColor().pitchText,
    fontWeight: "600",
  },
  announceCard: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  announceTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  announceEyebrow: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
  },
  announceBody: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: themeColor().text,
  },
  emptyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontFamily: "InstrumentSerif_400Regular", fontWeight: "700", color: themeColor().text },
  emptyBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  errTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().coralText },
  errBody: { marginTop: 8, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

