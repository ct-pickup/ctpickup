import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const SUPPORT_EMAIL = "pickupct@gmail.com";

type PolicyLink = {
  label: string;
  url: string;
};

type PolicyPoint = {
  title: string;
  body: string;
  links?: PolicyLink[];
};

const POLICY_POINTS: PolicyPoint[] = [
  {
    title: "Data we collect",
    body:
      "We collect information you provide when you use CT Pickup: your name, email, Instagram handle, playing position, ZIP code, nearest venue preference, and reliability score (based on attendance). We also collect account activity such as event registrations and chat messages you send within the app.",
  },
  {
    title: "How we use your information",
    body:
      "We use your information to operate the app, match you with nearby pickup runs and tournaments, process payments, send essential notifications, calculate reliability scores, provide customer support, and improve the platform.",
  },
  {
    title: "Third-party processors",
    body:
      "We use trusted service providers to run CT Pickup. Each processes data only as needed to provide their service:",
    links: [
      {
        label: "Stripe — payment processing",
        url: "https://stripe.com/privacy",
      },
      {
        label: "Supabase — database and authentication",
        url: "https://supabase.com/privacy",
      },
      {
        label: "Sentry — crash reporting and error monitoring",
        url: "https://sentry.io/privacy/",
      },
      {
        label: "OpenAI — Help assistant responses",
        url: "https://openai.com/policies/privacy-policy",
      },
      {
        label: "Expo — push notification delivery",
        url: "https://expo.dev/privacy",
      },
      {
        label: "Google Maps — drive-time calculations for venue proximity",
        url: "https://policies.google.com/privacy",
      },
    ],
  },
  {
    title: "Location",
    body:
      "We use your ZIP code and venue selection to match you with nearby runs. We do not access your device GPS or precise location.",
  },
  {
    title: "AI disclosure",
    body:
      "Our Help assistant uses OpenAI to generate responses. Questions you ask in Help are sent to OpenAI's API. Do not share sensitive personal information in Help chat.",
  },
  {
    title: "Payments",
    body:
      "Pickup and tournament fees are processed by Stripe. We do not store your full payment card details on our servers.",
  },
  {
    title: "Data retention",
    body:
      "Account data is kept until you delete your account. Payment and transaction records are retained for up to 7 years for legal and tax compliance.",
  },
  {
    title: "Account deletion",
    body:
      "You can delete your account at any time. Go to Profile → scroll to bottom → Delete Account. This permanently removes all your data from CT Pickup.",
  },
  {
    title: "Children",
    body:
      "CT Pickup is for users 13 and older. We do not knowingly collect data from children under 13. If you believe a child has provided information, contact us at pickupct@gmail.com.",
  },
  {
    title: "Content moderation",
    body: `We review reported content within 24–48 hours. Contact ${SUPPORT_EMAIL} for urgent issues.`,
  },
  {
    title: "Sharing",
    body:
      "We do not sell your personal information. We share data only with the service providers listed above, or when required by law.",
  },
  {
    title: "Security",
    body:
      "We take reasonable steps to protect your information, but no system is 100% secure. Use a strong password and keep your account access secure.",
  },
  {
    title: "Changes",
    body:
      "We may update this policy from time to time. Continued use of the app after changes means you accept the updated policy.",
  },
  {
    title: "Contact",
    body: `Questions about privacy? Email ${SUPPORT_EMAIL}.`,
  },
];

function openUrl(url: string) {
  void Linking.openURL(url);
}

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
        <Text style={styles.docSubtitle}>How CT Pickup collects, uses, and protects your information.</Text>

        <View style={styles.list}>
          {POLICY_POINTS.map((p) => (
            <View key={p.title} style={styles.card}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardBody}>{p.body}</Text>
              {p.links?.map((link) => (
                <Pressable
                  key={link.url}
                  onPress={() => openUrl(link.url)}
                  style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.linkText}>{link.label}</Text>
                </Pressable>
              ))}
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
  linkRow: {
    marginTop: 10,
  },
  linkText: {
    fontSize: 14,
    lineHeight: 20,
    color: LIME,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
