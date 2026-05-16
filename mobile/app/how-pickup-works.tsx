import { useNavigation } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

type Step = {
  number: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    number: "01",
    title: "Request Access",
    body: "Create your profile and get approved. Public runs are open to approved players in your region. Select runs are invite-only—you’ll get a notification when staff invites you.",
  },
  {
    number: "02",
    title: "Join or respond",
    body: "For public runs, request a spot first come first served. For select runs, tap the notification to confirm or decline when you’re invited.",
  },
  {
    number: "03",
    title: "Confirm Spot",
    body: "Once selected, you confirm your spot. Payment may be required to lock in.",
  },
  {
    number: "04",
    title: "Play",
    body: "Show up, compete, and stay consistent to maintain access to future runs.",
  },
];

const IMPORTANT_BULLETS: string[] = [
  "Spots are limited and fill quickly.",
  "Location is shared after confirmation.",
  "No-shows impact future eligibility.",
  "Reliability and level help you stay in the mix for future runs.",
];

export default function HowPickupWorksScreen() {
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions?.({
      title: "How pickup works",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HOW IT WORKS</Text>
      <Text style={styles.lead}>
        A quick walkthrough of how pickup runs work from request to play day.
      </Text>

      {STEPS.map((step) => (
        <View key={step.number} style={styles.card}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepNumber}>{step.number}</Text>
            <Text style={styles.stepTitle}>{step.title}</Text>
          </View>
          <Text style={styles.stepBody}>{step.body}</Text>
        </View>
      ))}

      <View style={[styles.card, styles.importantCard]}>
        <Text style={styles.importantLabel}>IMPORTANT</Text>
        <View style={styles.bulletList}>
          {IMPORTANT_BULLETS.map((item) => (
            <View key={item} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.65)",
  },
  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.58)",
  },
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: LIME,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    flexShrink: 1,
  },
  stepBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.72)",
  },
  importantCard: {
    marginTop: 22,
    borderColor: "rgba(163,230,53,0.28)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  importantLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: LIME,
  },
  bulletList: {
    marginTop: 12,
    gap: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bulletDot: {
    fontSize: 14,
    lineHeight: 21,
    color: LIME,
    width: 10,
    textAlign: "center",
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.78)",
  },
});
