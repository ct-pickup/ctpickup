import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { CardLoadingShimmer } from "@/components/CardLoadingShimmer";
import type { FieldTournamentPayload } from "@/hooks/useFieldTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

const LIME = "#a3e635";

function tournamentStatusLabel(payload: FieldTournamentPayload): string {
  if (payload.full) return "Full";
  if (payload.official) return "Official";
  if (payload.claimedTeams === 0 && payload.confirmedTeams === 0) return "Announced";
  return "Registration Open";
}

type Props = {
  loading: boolean;
  error: string | null;
  payload: FieldTournamentPayload | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** When there is no tournament row, show this instead of the default empty copy (e.g. no hub for zip). */
  emptyAlternateMessage?: string | null;
};

export function FieldTournamentCard({ loading, error, payload, onPress, style, emptyAlternateMessage }: Props) {
  if (loading) {
    return <CardLoadingShimmer style={style} />;
  }
  if (error) {
    return (
      <View style={style}>
        <View style={styles.card}>
          <View style={styles.cardAccent} />
          <View style={styles.row}>
            <View style={styles.iconBadge}>
              <FontAwesome name="trophy" size={28} color={LIME} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusKicker}>Couldn&apos;t load</Text>
              <Text style={styles.err}>{error}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }
  const t = payload?.tournament;
  if (!t) {
    const alt = typeof emptyAlternateMessage === "string" ? emptyAlternateMessage.trim() : "";
    if (alt.length > 0) {
      return (
        <View style={style}>
          <View style={styles.card}>
            <Text style={styles.emptyAlternate}>{alt}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={style}>
        <View style={styles.card}>
          <View style={styles.cardAccent} />
          <View style={styles.row}>
            <View style={styles.iconBadge}>
              <FontAwesome name="trophy" size={28} color={LIME} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusKicker}>No tournament announced</Text>
              <Text style={styles.emptySub}>When staff publish the outdoor / field bracket, it appears here.</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const { confirmedTeams, claimedTeams } = payload!;
  const maxTeams = t.maxTeams;
  const statusLabel = tournamentStatusLabel(payload!);

  const inner = (
    <>
      <View style={styles.cardAccent} />
      <View style={styles.row}>
        <View style={styles.iconBadge}>
          <FontAwesome name="trophy" size={28} color={LIME} />
        </View>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              {t.title}
            </Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{statusLabel}</Text>
            </View>
          </View>
        </View>
        {onPress ? <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" /> : null}
      </View>
      <Text style={styles.meta}>
        Confirmed teams {confirmedTeams} / {maxTeams} · Claims {claimedTeams}
      </Text>
      {t.announcement ? (
        <Text style={styles.announce} numberOfLines={3}>
          {t.announcement}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={[style, styles.card]}>
        {inner}
      </View>
    );
  }

  return (
    <AnimatedPressScale
      onPress={onPress}
      style={[style, styles.card, styles.cardInteractive]}
      accessibilityRole="button"
      accessibilityLabel={`In-person tournament ${t.title}`}
      hapticOnPress
    >
      {inner}
    </AnimatedPressScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    overflow: "hidden",
    padding: 18,
    paddingLeft: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: LIME,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardInteractive: {},
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexShrink: 0,
  },
  statusPillText: { color: LIME, fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  statusKicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.92)",
  },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff", lineHeight: 24, minWidth: 0 },
  meta: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.72)", lineHeight: 20 },
  announce: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.58)", lineHeight: 21 },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.5)" },
  emptyAlternate: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
  },
  err: { marginTop: 8, fontSize: 14, color: "#fca5a5", lineHeight: 20 },
});
