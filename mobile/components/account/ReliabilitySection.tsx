import { ActivityIndicator, Text, View } from "react-native";
import { accountStyles as styles } from "./accountStyles";

type Props = {
  loading: boolean;
  label: string | null;
  scorePct: number | null;
  subtext: string | null;
};

export function ReliabilitySection({ loading, label, scorePct, subtext }: Props) {
  return (
    <>
      <Text style={styles.sectionTitle}>Reliability</Text>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.cardLoadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.cardLoadingText}>Loading score…</Text>
          </View>
        ) : label == null && scorePct == null ? (
          <Text style={styles.cardMuted}>Reliability score isn’t available yet.</Text>
        ) : (
          <>
            <View style={styles.reliabilityHeader}>
              <Text style={styles.reliabilityLabel}>{label ?? "Reliability"}</Text>
              {scorePct != null ? (
                <View style={styles.scorePill}>
                  <Text style={styles.scorePillText}>{scorePct}%</Text>
                </View>
              ) : null}
            </View>
            {subtext ? <Text style={styles.cardSubtle}>{subtext}</Text> : null}
          </>
        )}
      </View>
    </>
  );
}
