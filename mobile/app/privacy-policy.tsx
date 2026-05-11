import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";

type PolicyPoint = {
  title: string;
  body: string;
};

const POLICY_POINTS: PolicyPoint[] = [
  {
    title: "What we collect",
    body:
      "We collect information you provide (such as your name, email, and profile details) and information needed to run CT Pickup (such as registrations, attendance, and app settings).",
  },
  {
    title: "How we use your information",
    body:
      "We use your information to operate the app, manage pickups and tournaments, communicate essential updates, provide support, and improve the platform experience.",
  },
  {
    title: "Payments",
    body:
      "If you make purchases, payment processing may be handled by third-party providers. We do not store your full payment card details on our servers.",
  },
  {
    title: "Location",
    body:
      "We may use coarse location or region selection to show relevant pickups and experiences. You can control location permissions in your device settings.",
  },
  {
    title: "Sharing",
    body:
      "We do not sell your personal information. We may share information with service providers that help us run the app (for example, hosting and analytics) or when required by law.",
  },
  {
    title: "Communications",
    body:
      "We may send account-related messages (like confirmations, reminders, and important policy updates). You can opt out of non-essential marketing communications where applicable.",
  },
  {
    title: "Data retention",
    body:
      "We keep information only as long as needed for the purposes described above, including maintaining records of activity and complying with legal obligations.",
  },
  {
    title: "Security",
    body:
      "We take reasonable steps to protect your information, but no system can be guaranteed 100% secure. Use a strong password and keep your account access secure.",
  },
  {
    title: "Children",
    body:
      "CT Pickup is intended for users age 13 and older. If you believe a child has provided personal information, contact us so we can address it.",
  },
  {
    title: "Changes",
    body:
      "We may update this policy from time to time. Continued use of the app after changes means you accept the updated policy.",
  },
  {
    title: "Contact",
    body:
      "If you have questions about privacy or data handling, contact CT Pickup support through the app or via the contact method listed on our website.",
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 16) + 24;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>Privacy Policy</Text>
        <Text style={styles.docSubtitle}>How CT Pickup collects, uses, and protects information.</Text>

        <View style={styles.list}>
          {POLICY_POINTS.map((p) => (
            <View key={p.title} style={styles.card}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardBody}>{p.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  docTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  docSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  list: { gap: 12 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  cardBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 21,
  },
});
