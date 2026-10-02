import { ActivityIndicator, Text, View } from "react-native";
import { accountStyles as styles, publish_accountStyles } from "./accountStyles";

import { themeColor, useThemedStyles } from "@/theme";
type Props = {
  loading: boolean;
  label: string | null;
  scorePct: number | null;
  subtext: string | null;
};

export function ReliabilitySection({ loading, label, scorePct, subtext }: Props) {
  useThemedStyles(publish_accountStyles);

  return (
    <>
      <Text style={styles.sectionTitle}>Reliability</Text>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.cardLoadingRow}>
            <ActivityIndicator color={themeColor().text} />
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
