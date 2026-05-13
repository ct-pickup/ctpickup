import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { FieldTournamentPayload, parseFieldPayload } from "@/hooks/useFieldTournament";
import { fetchTournamentPublic } from "@/lib/siteApi";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useState } from "react";
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

function headlineFor(data: FieldTournamentPayload): string {
  if (!data.tournament) return "No live tournament";
  if (data.full) return "Tournament full";
  if (data.official) return "Tournament confirmed";
  return "Organizing";
}

export default function TournamentStatusScreen() {
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
    >
      {!regionReady || loading ? (
        <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
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
              <FontAwesome name="trophy" size={18} color={LIME} />
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
                <FontAwesome name="bullhorn" size={18} color={LIME} />
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

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 36 },
  spinner: { marginTop: 32 },
  headline: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    lineHeight: 34,
    marginBottom: 18,
  },
  card: {
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
    marginBottom: 10,
  },
  cardEyebrowNoMb: { marginBottom: 0 },
  tournamentTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 26,
    marginBottom: 14,
  },
  statsBlock: { gap: 8 },
  statLine: { fontSize: 15, lineHeight: 22 },
  statLabel: { color: "rgba(255,255,255,0.6)" },
  statEmph: { color: "#fff", fontWeight: "700" },
  thresholdLine: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    fontSize: 14,
    lineHeight: 20,
    color: LIME,
    fontWeight: "600",
  },
  announceCard: {
    marginBottom: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.28)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  announceTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  announceEyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    color: LIME,
    textTransform: "uppercase",
  },
  announceBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.92)",
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
