import { AnimatedPressScale } from "@/components/AnimatedPressScale";
import { CardLoadingShimmer } from "@/components/CardLoadingShimmer";
import type { FieldTournamentPayload } from "@/hooks/useFieldTournament";
import { formatTournamentStartDisplay } from "@/lib/formatTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { headline, themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

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
              <FontAwesome name="trophy" size={28} color={themeColor().pitchText} />
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
              <FontAwesome name="trophy" size={28} color={themeColor().pitchText} />
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
          <FontAwesome name="trophy" size={28} color={themeColor().pitchText} />
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
        {onPress ? <FontAwesome name="chevron-right" size={14} color={themeColor().muted} /> : null}
      </View>
      <Text style={styles.meta}>
        Confirmed teams {confirmedTeams} / {maxTeams} · Claims {claimedTeams}
      </Text>
      {t.start_at ? (
        <Text style={styles.when}>{formatTournamentStartDisplay(t.start_at)}</Text>
      ) : null}
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

function make_styles() {
  return StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: "hidden",
    padding: 16,
    paddingLeft: 20,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: themeColor().pitch,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardInteractive: {},
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().pitchPanel,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
    backgroundColor: themeColor().overlaySubtle,
    flexShrink: 0,
  },
  statusPillText: { color: themeColor().pitchText, fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700",},
  statusKicker: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().text,
  },
  title: { flex: 1, fontSize: 20, ...headline, color: themeColor().text, lineHeight: 24, minWidth: 0 },
  meta: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 20 },
  when: { marginTop: 4, fontSize: 14, fontFamily: "Inter_600SemiBold", color: themeColor().text, lineHeight: 20, fontWeight: "600" },
  announce: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 21 },
  emptySub: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, color: themeColor().muted },
  emptyAlternate: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: themeColor().muted,
    textAlign: "center",
  },
  err: { marginTop: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().coralText, lineHeight: 20 },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

