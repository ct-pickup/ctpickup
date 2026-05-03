import type { FieldTournamentPayload } from "@/hooks/useFieldTournament";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const LIME = "#a3e635";

type Props = {
  loading: boolean;
  error: string | null;
  payload: FieldTournamentPayload | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function FieldTournamentCard({ loading, error, payload, onPress, style }: Props) {
  if (loading) {
    return (
      <View style={style}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <FontAwesome name="trophy" size={20} color="rgba(255,255,255,0.55)" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusKicker}>Checking…</Text>
              <ActivityIndicator size="small" color={LIME} style={{ marginTop: 14, alignSelf: "flex-start" }} />
            </View>
          </View>
        </View>
      </View>
    );
  }
  if (error) {
    return (
      <View style={style}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <FontAwesome name="trophy" size={20} color="rgba(255,255,255,0.55)" />
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
    return (
      <View style={style}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <FontAwesome name="trophy" size={20} color="rgba(255,255,255,0.55)" />
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

  const { confirmedTeams, claimedTeams, official, full } = payload!;
  const maxTeams = t.maxTeams;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [style, styles.card, styles.cardInteractive, pressed && onPress && { opacity: 0.92 }]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`In-person tournament ${t.title}`}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <FontAwesome name="trophy" size={20} color="rgba(255,255,255,0.55)" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusKicker}>Tournament announced</Text>
          <Text style={styles.title}>{t.title}</Text>
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
      <View style={styles.pillRow}>
        {official ? (
          <View style={[styles.pill, styles.pillOfficial]}>
            <Text style={styles.pillText}>Official draw</Text>
          </View>
        ) : null}
        {full ? (
          <View style={[styles.pill, styles.pillFull]}>
            <Text style={styles.pillText}>Full</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardInteractive: {},
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusKicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.92)",
  },
  title: { marginTop: 8, fontSize: 18, fontWeight: "700", color: "#fff", lineHeight: 24 },
  meta: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.72)", lineHeight: 20 },
  announce: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.58)", lineHeight: 21 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pillOfficial: { borderWidth: 1, borderColor: "rgba(163,230,53,0.35)" },
  pillFull: { borderWidth: 1, borderColor: "rgba(251,146,60,0.45)" },
  pillText: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "700" },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.5)" },
  err: { marginTop: 8, fontSize: 14, color: "#fca5a5", lineHeight: 20 },
});
