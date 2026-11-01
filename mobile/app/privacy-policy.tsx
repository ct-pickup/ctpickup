import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PRIVACY_POLICY_LAST_UPDATED } from "@/lib/cancellationPolicyCopy";
import { PRIVACY_GENDER_BODY, PRIVACY_GENDER_TITLE } from "@/lib/genderPrivacyCopy";
import { headline, themeColor, useThemedStyles } from "@/theme";
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
      "We collect information you provide when you use Competitive Together (operated by CT Pickup LLC): your name, email, Instagram handle, playing position, ZIP code, nearest venue preference, and reliability score (based on attendance). We also collect account activity such as event registrations and chat messages you send within the app.",
  },
  {
    title: "How we use your information",
    body:
      "We use your information to operate the app, match you with nearby pickup runs and tournaments, process payments, send essential notifications, calculate reliability scores, provide customer support, and improve the platform.",
  },
  {
    title: PRIVACY_GENDER_TITLE,
    body: PRIVACY_GENDER_BODY,
  },
  {
    title: "Usage data",
    body:
      "We keep a first-party record of how the app is used so we can make it better. We run it ourselves: no third-party analytics tools, no advertising identifiers, and we do not track you across other companies’ apps or websites. Game activity is recorded because the game needs it: when you join, cancel, join a waitlist, are marked present or absent, vote after a game, ask for a field, or change a notification setting, and when we send you a notification. If “Share usage data” is on in Settings, the app also records which screens you open, which suggested games you see and tap, and whether you open a notification. We never record what you type, your contacts, your exact location, or any device or Wi-Fi fingerprint. These records name a game and a general area such as CT, not a place. Only admins can see them. Turn off Share usage data in Settings at any time to stop the app-side records. Usage records are kept up to 24 months and are deleted when you delete your account.",
  },
  {
    title: "Third-party processors",
    body:
      "We use trusted service providers to run Competitive Together. Each processes data only as needed to provide their service:",
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
      "Account data is kept until you delete your account. Usage records are kept up to 24 months. Payment and transaction records are retained for up to 7 years for legal and tax compliance.",
  },
  {
    title: "Account deletion",
    body:
      "You can delete your account at any time. Go to Profile → scroll to bottom → Delete Account. This permanently removes all your data from Competitive Together, including your usage records.",
  },
  {
    title: "Children",
    body:
      "Competitive Together is for users 13 and older. We do not knowingly collect data from children under 13. If you believe a child has provided information, contact us at pickupct@gmail.com.",
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
  useThemedStyles(publish_styles);

  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 16) + 24;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>Privacy Policy</Text>
        <Text style={styles.docSubtitle}>How Competitive Together collects, uses, and protects your information.</Text>
        <Text style={styles.lastUpdated}>{PRIVACY_POLICY_LAST_UPDATED}</Text>

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

function make_styles() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().bg },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  docTitle: {
    color: themeColor().text,
    fontSize: 32, ...headline,
    marginBottom: 8,
  },
  docSubtitle: {
    color: themeColor().muted,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 4,
  },
  lastUpdated: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_400Regular",
    marginBottom: 24,
  },
  list: { gap: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardTitle: {
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    marginBottom: 8,
  },
  cardBody: {
    color: themeColor().text,
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  linkRow: {
    marginTop: 8,
  },
  linkText: {
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
    color: themeColor().pitchText,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

